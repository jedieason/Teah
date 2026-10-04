import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const fixture = await readFile('tests/fixtures/firebase.js', 'utf8');
const bank = '檢驗｜測試';
const q = { questionId: 'q1', question: 'PCR 的 Ct 相差 5，起始量比為何？', options: { A: '5:1', B: '32:1' }, answer: 'B', explanation: '理想倍增下是 2 的 5 次方。', revision: 1 };
const mistakes = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`m${i}`, { ...q, questionId: `q${i + 1}`, status: 'active', count: 2, lastMistake: 100 - i }]));
mistakes.mastered = { ...q, questionId: 'mastered', status: 'mastered', count: 1 };
const legacy = { card_old: { front: '舊筆記字卡', back: '舊答案' }, deck_old: { title: '舊複習卡', cards: [{ front: '舊問題', back: '舊解答' }] } };
await context.addInitScript(data => { window.__testDatabase = JSON.parse(sessionStorage.getItem('generation-db') || JSON.stringify(data)); }, {
    API_KEY: 'test-only', [bank]: [q], quizCatalog: { [bank]: { count: 1 } }, mistakes: { 'test-user': { [bank]: mistakes } }, learning: { 'test-user': legacy }
});
await context.route('**/src/services/firebase.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, r => r.abort());
let requests = [], mode = 'fail', releasePending;
function responseFor(input) {
    return { title: input.sources.length ? 'PCR 字卡' : '水果字卡', description: '依指令整理', termLanguage: input.sources.length ? 'zh-TW' : 'en-US', definitionLanguage: 'zh-TW',
        cards: [{ term: input.sources.length ? 'Ct 相差 5 次，理想起始量比為何？' : 'apple', definition: input.sources.length ? '32:1' : '蘋果',
            termAliases: [], definitionAliases: input.sources.length ? ['32 to 1'] : [], sourceIds: input.sources.length ? ['s1'] : [] }] };
}
await context.route('https://generativelanguage.googleapis.com/**', async route => {
    const request = route.request().postDataJSON(), input = JSON.parse(request.contents[0].parts[0].text); requests.push(input);
    if (mode === 'fail') return route.fulfill({ status: 503, body: '{}' });
    const respond = async () => {
        try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ finishReason: mode === 'truncated' ? 'MAX_TOKENS' : 'STOP', content: { parts: [{ text: JSON.stringify(responseFor(input)) }] } }] }) }); } catch { /* Closed/cancelled request. */ }
    };
    if (mode === 'pending') return new Promise(resolve => { releasePending = async () => { await respond(); resolve(); }; });
    return respond();
});
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(25000);
page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
const view = page.locator('#flashcardPage'), dialog = page.getByRole('dialog', { name: 'AI 生成字卡', exact: true });
const countDecks = () => page.evaluate(() => Object.keys(window.__testDatabase.flashcard?.['test-user']?.sets || {}).length);
const persist = async () => page.evaluate(async () => { await (await import('/src/features/flashcard/service.js')).flushOutbox(); sessionStorage.setItem('generation-db', JSON.stringify(window.__testDatabase)); });
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('button', { name: '複習卡', exact: true }).count(), 0);
    assert.equal(await page.locator('#flashcardsView').count(), 0);
    await page.locator('#homeMistakes').click(); await page.locator('#mistakeView[aria-busy="false"]').waitFor();
    assert.match(await page.locator('#mistakeFlashcardsBtn').innerText(), /前 30 題/);
    await page.locator('#mistakeSelectAll').check(); await page.locator('#mistakeFlashcardsBtn').click();
    await page.locator('#customAlert').getByText('每次最多選取 30 題錯題。', { exact: true }).waitFor();
    await page.locator('#mistakeClearSelection').click(); await page.locator('#mistakeFlashcardsBtn').click();
    assert.equal(await view.isVisible(), false); assert.equal(requests.length, 0);
    const prompt = dialog.getByLabel('生成指令（選填）'), instructions = '只整理 Ct 判讀，用問答與條列，生成一張';
    await prompt.fill(instructions); await dialog.getByRole('button', { name: '生成字卡', exact: true }).click();
    await dialog.getByText('AI 暫時無法生成字卡，請重試。', { exact: true }).waitFor();
    assert.equal(await prompt.inputValue(), instructions); assert.equal(await view.isVisible(), false); assert.equal(await countDecks(), 0);
    assert.equal(requests[0].sources.length, 30); assert.equal(requests[0].sources[0].questionId, 'q1');
    assert.ok(requests[0].sources.every(s => s.questionId !== 'mastered')); assert.equal(requests[0].instructions, instructions);
    mode = 'truncated'; await dialog.getByRole('button', { name: '生成字卡', exact: true }).click();
    await dialog.getByText('字卡未完整生成，請重試。', { exact: true }).waitFor(); assert.equal(await countDecks(), 0);
    mode = 'ok'; await dialog.getByRole('button', { name: '生成字卡', exact: true }).click();
    await view.getByRole('heading', { name: '編輯字卡集', exact: true }).waitFor();
    assert.equal(await dialog.isVisible(), false); assert.equal(await page.locator('#mistakeView').isVisible(), false);
    assert.equal(await view.getByLabel('字卡集名稱', { exact: true }).inputValue(), 'PCR 字卡');
    assert.equal(await view.getByLabel('單字 1', { exact: true }).inputValue(), 'Ct 相差 5 次，理想起始量比為何？');
    await persist(); assert.equal(await countDecks(), 1);
    assert.deepEqual(await page.evaluate(() => window.__testDatabase.learning['test-user']), legacy);
    await view.getByLabel('字卡集名稱', { exact: true }).fill('我的 PCR 字卡');
    await view.getByLabel('解釋 1', { exact: true }).fill('32 倍');
    await view.getByRole('button', { name: '完成', exact: true }).click(); await persist();
    let stored = await page.evaluate(() => Object.values(window.__testDatabase.flashcard['test-user'].sets)[0]);
    assert.equal(stored.title, '我的 PCR 字卡'); assert.equal(stored.cards[0].definition, '32 倍'); assert.equal(stored.revision, 2);
    assert.deepEqual(stored.cards[0].definitionAliases, ['32 to 1']);
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
    await page.keyboard.press('Space'); await view.locator('.vocab-flip.flipped').waitFor(); await page.keyboard.press('Escape');
    await persist(); await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#homeFlashcard').click(); await view.getByRole('button', { name: '我的 PCR 字卡', exact: true }).click();
    await view.getByRole('button', { name: '編輯字卡集', exact: true }).click();
    assert.equal(await view.getByLabel('解釋 1', { exact: true }).inputValue(), '32 倍');
    await view.getByRole('button', { name: '‹ 字卡集', exact: true }).click();
    await page.locator('#homeLibrary').click(); await page.locator('#homeMistakes').click(); await page.locator('#mistakeView[aria-busy="false"]').waitFor();
    // Selected scope, default instructions and cancellation stay on the notebook.
    await page.locator('.review-meta input').first().check(); await page.locator('#mistakeFlashcardsBtn').click();
    mode = 'pending'; await dialog.getByRole('button', { name: '生成字卡', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.vocab-generation-form')?.getAttribute('aria-busy') === 'true');
    while (!releasePending) await page.waitForTimeout(20);
    assert.equal(requests.at(-1).sources.length, 1); assert.equal(requests.at(-1).instructions, ''); assert.equal(await view.isVisible(), false);
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); await releasePending(); releasePending = null;
    assert.equal(await page.locator('#mistakeView').isVisible(), true); await persist(); assert.equal(await countDecks(), 1);
    await page.locator('#closeMistakeViewBtn').click(); await page.locator('#homeFlashcard').click();
    if (await view.getByRole('button', { name: '‹ Flashcard', exact: true }).isVisible()) await view.getByRole('button', { name: '‹ Flashcard', exact: true }).click();
    // Direct generation requires a prompt and has the same pre-generation flow on mobile.
    await page.setViewportSize({ width: 390, height: 844 }); await view.getByRole('button', { name: 'AI 生成字卡', exact: true }).click();
    await dialog.getByRole('button', { name: '生成字卡', exact: true }).click(); assert.equal(await countDecks(), 1);
    await dialog.getByLabel('生成指令', { exact: true }).fill('生成一張英文水果單字卡，背面用繁體中文');
    assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false);
    await mkdir('artifacts/qa', { recursive: true }); await page.screenshot({ path: 'artifacts/qa/flashcard-generation-mobile.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    await page.screenshot({ path: 'artifacts/qa/flashcard-generation-dark-mobile.png', fullPage: true });
    mode = 'ok'; await page.evaluate(() => { window.__failWrites = true; });
    await dialog.getByRole('button', { name: '生成字卡', exact: true }).click();
    await view.getByRole('heading', { name: '編輯字卡集', exact: true }).waitFor();
    assert.deepEqual(requests.at(-1).sources, []); assert.equal(await view.getByLabel('單字 1', { exact: true }).inputValue(), 'apple');
    assert.equal(await view.evaluate(e => e.scrollWidth > e.clientWidth), false);
    await page.screenshot({ path: 'artifacts/qa/flashcard-generated-editor-mobile.png', fullPage: true });
    assert.equal(await countDecks(), 1, 'failed cloud writes retain a local deck until sync');
    await page.evaluate(() => { window.__failWrites = false; }); await persist(); assert.equal(await countDecks(), 2);
    assert.deepEqual(await page.evaluate(() => window.__testDatabase.learning['test-user']), legacy);
    assert.equal(await page.evaluate(bank => window.__testDatabase.mistakes['test-user'][bank].m0.count, bank), 2);
    assert.deepEqual(errors, []);
    console.log('Flashcard generation passed: prompts before editing, source limits/filtering, failures/retry, native persistence, editing/reload, cancel, direct prompts, mobile/dark and offline retry.');
} catch (error) { await mkdir('artifacts/qa', { recursive: true }); await page.screenshot({ path: 'artifacts/qa/flashcard-generation-failure.png', fullPage: true }); throw error; }
finally { if (releasePending) await releasePending(); await browser.close(); }
