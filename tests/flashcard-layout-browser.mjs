import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck } from '../src/features/flashcard/model.js';

const medical = prepareDeck({ title: '病理學 Micro', cards: [
    { term: 'Necrotizing enterocolitis', definition: 'Intestine/colon\n1. Coagulative necrosis with hemorrhage – mucosal and transmural (impending perforation)\n2. Chronic changes: strictures, crypt distortion, reactive epithelial cells' },
    { term: 'Ischemic colitis', definition: 'Colon\nIschemic injury to the bowel.' },
    { term: 'Long clinical case', definition: Array.from({ length: 30 }, (_, i) => `${i + 1}. Clinical findings: abdominal pain, inflammation and tissue injury.`).join('\n') },
    { term: 'Crohn disease', definition: 'Transmural inflammation' }
] });
const longAnswers = prepareDeck({ title: '長選項', cards: Array.from({ length: 4 }, (_, i) => ({
    term: `Clinical finding ${i + 1}: coagulative necrosis with hemorrhage, crypt distortion and reactive epithelial cells`, definition: `Finding ${i + 1}`
})) });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, hasTouch: true });
await context.addInitScript(data => {
    window.__testDatabase = data;
    // Model the independently shrinking/offset visual viewport of an on-screen keyboard.
    window.__setStudyViewport = (height, offsetTop = 0) => {
        Object.defineProperties(visualViewport, { height: { configurable: true, value: height }, offsetTop: { configurable: true, value: offsetTop } });
        visualViewport.dispatchEvent(new Event('resize'));
    };
}, { quizCatalog: {}, flashcard: { 'test-user': { sets: { [medical.id]: medical, [longAnswers.id]: longAnswers } } } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
const view = page.locator('#flashcardPage'), options = page.getByRole('dialog', { name: 'Learn 設定', exact: true });
const idle = () => page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
const settle = () => view.locator('.vocab-question').evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
const state = async () => {
    await page.evaluate(async () => (await import('/src/features/flashcard/service.js')).flushOutbox());
    return page.evaluate(id => window.__testDatabase.flashcard['test-user'].study[id], medical.id);
};
async function configure(type) {
    await view.getByRole('button', { name: 'Learn', exact: true }).click();
    await options.getByRole('button', { name: '學習設定', exact: true }).click();
    const types = options.locator('.vocab-setting-section').first();
    assert.equal(await types.evaluate(e => e.open), true);
    for (const input of await types.getByRole('checkbox').all()) await input.uncheck();
    await types.getByLabel(type, { exact: true }).check();
    await options.locator('summary').filter({ hasText: '批改方式' }).click();
    await options.getByLabel('批改方式', { exact: true }).selectOption('exact');
    await options.getByRole('button', { name: '開始 Learn', exact: true }).click(); await idle(); await settle();
}
await mkdir('artifacts/qa', { recursive: true });
try {
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    await view.getByRole('button', { name: medical.title, exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await configure('書寫／填空題');
    const input = view.getByLabel('你的答案', { exact: true });
    assert.equal(await input.evaluate(e => document.activeElement === e), false, 'a mobile question lets the user read before opening the keyboard');
    const prompt = await view.locator('.vocab-prompt').boundingBox();
    assert.ok(prompt.width >= 350, 'the mobile prompt uses the reading width without nested card padding');
    const confirm = view.getByRole('button', { name: '確認答案', exact: true });
    assert.equal(await confirm.isDisabled(), true);
    assert.ok((await confirm.boundingBox()).y + (await confirm.boundingBox()).height <= 844, 'the recorded medical prompt and answer actions fit together');
    const hint = await view.getByRole('button', { name: '顯示提示', exact: true }).boundingBox(), field = await input.boundingBox();
    assert.ok(hint.y >= field.y + field.height, 'the hint follows the input');
    await view.getByRole('button', { name: '不知道', exact: true }).hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'artifacts/qa/hover-dontknow.png' });
    await view.getByRole('button', { name: '顯示提示', exact: true }).hover();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'artifacts/qa/hover-hint.png' });
    await page.screenshot({ path: 'artifacts/qa/learn-medical-mobile.png' });
    await input.fill('Coagulative necrosis');
    assert.equal(await confirm.isEnabled(), true);
    await page.evaluate(() => window.__setStudyViewport(440, 100));
    await page.waitForFunction(() => {
        const host = document.getElementById('flashcardPage'), action = host.querySelector('.vocab-question-actions').getBoundingClientRect();
        return Math.abs(host.getBoundingClientRect().height - 440) < 1 && action.bottom <= 540 && action.top >= 100;
    });
    const visibleInput = await input.boundingBox(); assert.ok(visibleInput.y >= 100 && visibleInput.y + visibleInput.height <= 540, 'input and submit stay in the usable viewport');
    await page.evaluate(() => window.__setStudyViewport(844));
    await input.press('Enter'); await view.getByText('答錯了', { exact: true }).waitFor(); await idle();
    assert.equal(await view.getByRole('button', { name: '不知道', exact: true }).count(), 0, 'completed answers have no disabled unknown action');
    assert.equal(await view.locator('.vocab-incorrect-answer').evaluate(e => getComputedStyle(e).textDecorationLine), 'none', 'the original answer stays legible');
    assert.equal(await view.locator('.vocab-correct-answer').innerText(), 'Necrotizing enterocolitis');
    const continueButton = view.getByRole('button', { name: '繼續', exact: true }), override = view.getByRole('button', { name: '我的答案其實正確', exact: true });
    const continueBounds = await continueButton.boundingBox(), overrideBounds = await override.boundingBox();
    assert.ok(continueBounds.width >= 350 && continueBounds.y + continueBounds.height <= overrideBounds.y, 'Continue is the full-width primary action before the manual override');
    assert.ok(overrideBounds.y + overrideBounds.height <= 844, 'the complete result stays visible');
    assert.equal(Object.values((await state()).events).filter(e => e.kind === 'answer').length, 1);
    await view.locator('.vocab-answer-result').evaluate(e => Promise.all(e.getAnimations().map(a => a.finished)));
    await page.screenshot({ path: 'artifacts/qa/learn-medical-result-mobile.png' });
    await continueButton.click(); await idle(); await settle();
    assert.ok(await view.evaluate(e => e.scrollTop <= 1), 'the next question starts at the top of the study scroller');
    assert.equal(await input.evaluate(e => document.activeElement === e), false);
    await view.getByRole('button', { name: '不知道', exact: true }).click(); await idle();
    assert.equal(await view.locator('.vocab-correct-answer').innerText(), 'Ischemic colitis', 'unknown Learn written answers reveal the answer');
    assert.equal(await view.locator('.vocab-response').count(), 0);
    assert.equal(await override.count(), 0, 'an unknown answer cannot be manually marked correct');
    await continueButton.click(); await idle(); await settle();
    await input.fill('draft answer');
    await view.evaluate(e => { e.scrollTop = 120; });
    const oldScroll = await view.evaluate(e => e.scrollTop);
    await view.getByRole('button', { name: '標記星號', exact: true }).click(); await idle();
    assert.equal(await input.inputValue(), 'draft answer');
    assert.ok(Math.abs(await view.evaluate(e => e.scrollTop) - oldScroll) < 1, 'starring retains the reading position');
    assert.equal(await view.locator('.vocab-question').evaluate(e => e.getAnimations().length), 0, 'starring does not replay the question entrance');
    await page.setViewportSize({ width: 320, height: 568 }); await page.evaluate(() => window.__setStudyViewport(568));
    await confirm.scrollIntoViewIfNeeded();
    assert.equal(await view.evaluate(e => e.scrollWidth > e.clientWidth), false);
    assert.ok((await confirm.boundingBox()).y + (await confirm.boundingBox()).height <= 568, 'very long prompts remain scrollable on small phones');
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.__setStudyViewport(844));
    await view.getByRole('button', { name: '設定', exact: true }).click(); await view.getByRole('button', { name: '全部設定', exact: true }).click();
    const beforeSettings = (await state()).sessions.learn;
    const settingsBounds = await options.boundingBox(); assert.equal(settingsBounds.width, 390); assert.equal(settingsBounds.height, 844);
    await page.screenshot({ path: 'artifacts/qa/learn-options-mobile.png' });
    await options.locator('summary').filter({ hasText: '作答方向' }).click();
    await options.getByLabel('作答方向', { exact: true }).selectOption('definition');
    await options.locator('.vocab-dialog-body').evaluate(e => { e.scrollTop = e.scrollHeight; });
    const footer = await options.locator('.vocab-options-footer').boundingBox(); assert.ok(footer.y + footer.height <= 844);
    await options.getByRole('button', { name: '取消', exact: true }).click(); await idle();
    const afterSettings = (await state()).sessions.learn;
    assert.equal(afterSettings.id, beforeSettings.id); assert.equal(afterSettings.current.key, beforeSettings.current.key); assert.equal(afterSettings.options.direction, beforeSettings.options.direction);
    assert.equal(await input.inputValue(), 'draft answer'); assert.equal(await input.evaluate(e => document.activeElement === e), false);
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    await confirm.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'artifacts/qa/learn-medical-dark-mobile.png' });
    await page.evaluate(() => document.documentElement.classList.remove('dark-mode'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await view.getByRole('button', { name: '不知道', exact: true }).click(); await idle();
    assert.equal(await view.locator('.vocab-answer-result').evaluate(e => e.getAnimations().length), 0, 'reduced motion also applies to feedback');
    await page.keyboard.press('Escape');
    await view.getByRole('button', { name: '‹ Flashcard', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1024 });
    await view.getByRole('button', { name: longAnswers.title, exact: true }).click(); await configure('選擇題');
    const columns = await view.locator('.vocab-choices').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 1, 'long desktop answers use the full readable width');
    await page.screenshot({ path: 'artifacts/qa/learn-long-answers-desktop.png' });
    assert.deepEqual(errors, []);
    console.log('Study layout passed: recorded medical content, mobile reading and actions, keyboard viewport, readable results, unknown reveals, scroll reset, draft/star stability, fullscreen cancelable options, narrow/dark/reduced-motion screens and long desktop choices.');
} catch (error) { await page.screenshot({ path: 'artifacts/qa/flashcard-layout-failure.png' }); throw error; }
finally { await browser.close(); }
