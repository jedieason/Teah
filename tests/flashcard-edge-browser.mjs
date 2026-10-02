import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck } from '../src/features/flashcard/model.js';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const synonyms = prepareDeck({ title: 'Synonyms', cards: [{ term: 'car', definition: '汽車', termAliases: ['automobile'] }, { term: 'apple', definition: '蘋果' }, { term: 'pear', definition: '梨' }] });
const large = prepareDeck({ title: '大量字卡', cards: Array.from({ length: 2000 }, (_, i) => ({ term: `vocabulary${i}`, definition: `解釋 ${i}\nline two` })) });
const db = { API_KEY: 'test-only', quizCatalog: { Demo: { count: 1 } }, flashcard: { 'test-user': { sets: { [synonyms.id]: synonyms, [large.id]: large } } } };
await context.addInitScript(data => {
    window.__testDatabase = JSON.parse(sessionStorage.getItem('edge-db') || JSON.stringify(data)); window.__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: u => window.__spoken.push(u.text), cancel() {} } });
}, db);
let fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
// Realtime Database removes empty arrays/objects. Exercise hydration against that actual wire shape.
fixture = fixture.replace('const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));', `const prune = v => {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  const value = Array.isArray(v) ? [] : {};
  for (const [k, entry] of Object.entries(v)) { const child = prune(entry); if (child != null) value[k] = child; }
  return Object.keys(value).length ? value : null;
}; const clone = v => prune(v);`);
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
let semanticCalls = 0;
await context.route('https://generativelanguage.googleapis.com/**', async route => {
    semanticCalls++; const request = route.request().postDataJSON(); assert.equal(request.generationConfig.temperature, 0);
    const data = JSON.parse(request.contents[0].parts[0].text); assert.equal(data.response, 'an automobile'); assert.equal(data.expected, 'car');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"equivalent":true}' }] } }] }) });
});
const page = await context.newPage(); page.setDefaultTimeout(15000); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
const view = page.locator('#flashcardPage'), settings = page.getByRole('dialog', { name: 'Learn 設定', exact: true });
const idle = () => page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
await mkdir('artifacts/qa', { recursive: true });
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    await view.getByRole('button', { name: 'Synonyms', exact: true }).click();
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click(); await idle();
    await page.evaluate(() => sessionStorage.setItem('edge-db', JSON.stringify(window.__testDatabase)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click(); await view.getByRole('button', { name: 'Synonyms', exact: true }).click();
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click(); await idle();
    assert.equal(await view.locator('.vocab-flip').count(), 1); await page.keyboard.press('Space'); await view.locator('.flipped').waitFor();
    await view.getByRole('button', { name: '‹ Synonyms', exact: true }).click();
    await view.locator('.vocab-term').first().getByRole('button', { name: '標記星號', exact: true }).click(); await idle();
    await view.getByRole('button', { name: 'Learn', exact: true }).click();
    await settings.getByLabel('練習範圍', { exact: true }).selectOption('starred');
    await settings.getByLabel('這次學習的目標', { exact: true }).selectOption('quick');
    await settings.getByRole('button', { name: '開始 Learn', exact: true }).click(); await idle();
    await view.getByRole('checkbox', { name: 'car', exact: true }).check(); await view.getByRole('checkbox', { name: 'automobile', exact: true }).check();
    await view.getByRole('button', { name: '確認答案', exact: true }).click();
    await view.getByText('✓ 答對了', { exact: true }).waitFor(); await idle(); await view.getByRole('button', { name: '繼續', exact: true }).click({ force: true });
    await view.getByRole('heading', { name: '本次學習完成', exact: true }).waitFor();
    await view.getByRole('button', { name: '返回字卡集', exact: true }).click(); await view.getByRole('button', { name: 'Learn', exact: true }).click();
    await settings.getByLabel('這次學習的目標', { exact: true }).selectOption('master'); await settings.getByLabel('批改方式', { exact: true }).selectOption('relaxed');
    await settings.getByRole('button', { name: 'Write', exact: true }).click(); await idle();
    const answer = view.getByLabel('你的答案', { exact: true }); await answer.fill('an automobile'); await answer.press('Enter');
    await view.getByText('✓ 答對了', { exact: true }).waitFor(); assert.equal(semanticCalls, 1); await idle();
    await view.getByRole('button', { name: '繼續', exact: true }).click({ force: true }); await view.getByRole('heading', { name: '本次學習完成', exact: true }).waitFor();
    await view.getByRole('button', { name: '返回字卡集', exact: true }).click(); await view.getByRole('button', { name: 'Learn', exact: true }).click();
    await settings.getByLabel('練習範圍', { exact: true }).selectOption('all'); await settings.getByLabel('批改方式', { exact: true }).selectOption('strict');
    await settings.getByRole('button', { name: '重設 Learn 進度', exact: true }).click(); await settings.getByRole('button', { name: '確認重設並開始', exact: true }).click();
    await idle(); await view.getByRole('button', { name: '設定', exact: true }).click(); await settings.getByRole('button', { name: 'Spell', exact: true }).click();
    await view.getByRole('button', { name: '播放單字', exact: true }).waitFor();
    await page.waitForFunction(() => window.__spoken.length > 0); assert.equal(await page.evaluate(() => window.__spoken.at(-1)), 'car');
    await view.getByRole('button', { name: '‹ Synonyms', exact: true }).click();
    await view.getByRole('button', { name: '編輯字卡集', exact: true }).click();
    await view.getByLabel('字卡集名稱', { exact: true }).fill('本機修改');
    await page.evaluate(id => { window.__testDatabase.flashcard['test-user'].sets[id].revision++; window.__testDatabase.flashcard['test-user'].sets[id].title = '雲端修改'; }, synonyms.id);
    await view.getByRole('button', { name: '完成', exact: true }).click();
    await view.getByRole('button', { name: '保留本機版本為新字卡集', exact: true }).waitFor(); await idle();
    await page.screenshot({ path: 'artifacts/qa/vocabulary-conflict.png', fullPage: true });
    await view.getByRole('button', { name: '保留本機版本為新字卡集', exact: true }).click();
    await view.getByRole('heading', { name: '本機修改（本機副本）', exact: true }).waitFor();
    await page.waitForFunction(() => Object.values(window.__testDatabase.flashcard['test-user'].sets).some(d => d.title === '本機修改（本機副本）'));
    assert.equal(await page.evaluate(id => window.__testDatabase.flashcard['test-user'].sets[id].title, synonyms.id), '雲端修改');
    await view.getByRole('button', { name: '‹ Flashcard', exact: true }).click();
    await view.getByRole('button', { name: '大量字卡', exact: true }).click();
    await view.getByRole('button', { name: '編輯字卡集', exact: true }).click();
    await view.locator('.vocab-edit-row').first().waitFor(); await idle();
    assert.equal(await view.locator('.vocab-edit-row').count(), 2000);
    await view.getByLabel('解釋 2000', { exact: true }).fill('最後一張的修改');
    // Avoid an all-DOM accessible-name scan over thousands of editor tools; click the visible save control.
    assert.equal(await view.locator('.vocab-save-bottom').innerText(), '儲存字卡集');
    await view.locator('.vocab-save-bottom').click();
    await page.waitForFunction(id => window.__testDatabase.flashcard['test-user'].sets[id].revision === 2, large.id);
    assert.equal(await page.evaluate(id => window.__testDatabase.flashcard['test-user'].sets[id].cards[1999].definition, large.id), '最後一張的修改');
    await view.getByRole('button', { name: 'Learn', exact: true }).click(); await settings.getByLabel('聽寫題', { exact: true }).uncheck(); await settings.getByLabel('選擇題', { exact: true }).check(); await settings.getByLabel('書寫／填空題', { exact: true }).check(); await settings.getByRole('button', { name: '開始 Learn', exact: true }).click();
    await view.locator('.vocab-choices').waitFor(); await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await view.evaluate(e => e.scrollWidth > e.clientWidth), false); assert.ok(await view.locator('.vocab-learn-progress > span').count() <= 24);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-large-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Vocabulary edge cases passed: Firebase empty collections, flash reload, starred scope, select-all, optional semantic grading, Write/Spell, reset epochs, concurrent-edit preservation, 2000-term mobile progress.');
} catch (e) { console.error('Edge test failure:', e.message); await page.screenshot({ path: 'artifacts/qa/vocabulary-edge-failure.png' }).catch(() => {}); console.log((await view.innerText()).slice(0, 1800)); throw e; }
finally { await browser.close(); }
