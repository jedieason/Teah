import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck } from '../src/features/flashcard/model.js';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
const deck = prepareDeck({ title: '智慧判讀測試', cards: [{ term: 'myocardial infarction', definition: 'What is the diagnosis?' }] });
await mkdir('artifacts/qa', { recursive: true });

async function setup(level, score = .99, behaviour = 'score') {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(data => { window.__testDatabase = data; }, { flashcard: { 'test-user': { sets: { [deck.id]: deck } } }, quizCatalog: {} });
    await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
    await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
    let modelLoads = 0, geminiCalls = 0;
    await context.route('**/generativelanguage.googleapis.com/**', route => { geminiCalls++; return route.abort(); });
    await context.route('**/src/features/flashcard/equivalence-worker.js', route => {
        modelLoads++;
        return route.fulfill({ contentType: 'text/javascript', body: `self.onmessage = ({ data: { id, pair } }) => {
            if (pair.prompt !== 'What is the diagnosis?') throw new Error('Missing question context');
            self.postMessage({ id, progress: { status: 'inference' } });
            if (${JSON.stringify(behaviour)} === 'wait') return;
            if (${JSON.stringify(behaviour)} === 'offline') { self.postMessage({ id, error: 'Offline' }); return; }
            self.postMessage({ id, result: { forward: { entailment: ${score}, contradiction: .001 }, backward: { entailment: ${score}, contradiction: .001 } } });
        };` });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); }); page.setDefaultTimeout(15000);
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    const view = page.locator('#flashcardPage');
    await view.getByRole('button', { name: deck.title, exact: true }).click();
    await view.getByRole('button', { name: 'Learn', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Learn 設定', exact: true });
    await settings.getByRole('button', { name: '學習設定', exact: true }).click();
    const types = settings.locator('.vocab-setting-section').first();
    for (const input of await types.getByRole('checkbox').all()) await input.uncheck();
    await types.getByLabel('書寫／填空題', { exact: true }).check();
    await settings.locator('summary').filter({ hasText: '批改方式' }).click();
    const grading = settings.getByLabel('批改方式', { exact: true });
    assert.deepEqual(await grading.locator('option').allTextContents(), ['寬鬆', '標準', '嚴謹', '絕對相同']);
    assert.equal(await settings.getByText(/Gemini/).count(), 0);
    await grading.selectOption(level);
    await settings.getByRole('button', { name: '開始 Learn', exact: true }).click();
    const idle = () => page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
    await idle();
    await page.setViewportSize({ width: 390, height: 844 });
    const answer = view.getByLabel('你的答案', { exact: true });
    const submit = async response => { await answer.fill(response); await view.getByRole('button', { name: '確認答案', exact: true }).click(); };
    return { context, page, view, idle, submit, answer, counts: () => ({ modelLoads, geminiCalls }), check: () => assert.deepEqual(errors, []) };
}

try {
    // MeSH handles terms before a model is loaded, including in rigorous mode.
    let t = await setup('rigorous');
    await t.submit('heart attack'); await t.idle();
    await t.view.getByText('✓ 答對了', { exact: true }).waitFor();
    assert.equal(t.counts().modelLoads, 0);
    await t.view.getByRole('button', { name: '我是錯的', exact: true }).waitFor();
    await t.page.waitForTimeout(1100);
    assert.equal(await t.view.locator('.vocab-response').isVisible(), true);
    assert.equal(await t.view.evaluate(e => e.scrollWidth > e.clientWidth), false);
    await t.page.screenshot({ path: 'artifacts/qa/equivalence-concept-mobile.png', fullPage: true });
    await t.view.getByRole('button', { name: '我是錯的', exact: true }).click(); await t.idle();
    await t.view.getByText('答錯了', { exact: true }).waitFor(); t.check(); await t.context.close();

    for (const [level, correct] of [['relaxed', true], ['standard', false], ['rigorous', false]]) {
        t = await setup(level, .85);
        await t.submit('MI'); await t.idle();
        await t.view.getByText(correct ? '✓ 答對了' : '無法確定，請核對正確答案', { exact: true }).waitFor();
        assert.equal(t.counts().modelLoads, 1); assert.equal(t.counts().geminiCalls, 0);
        if (!correct) {
            await t.view.getByRole('button', { name: '我的答案其實正確', exact: true }).click(); await t.idle();
            await t.view.getByText('✓ 答對了', { exact: true }).waitFor();
        }
        t.check(); await t.context.close();
    }

    t = await setup('exact');
    await t.submit('ＭＹＯＣＡＲＤＩＡＬinfarction!'); await t.idle();
    await t.view.getByText('✓ 答對了', { exact: true }).waitFor();
    assert.equal(t.counts().modelLoads, 0);
    await t.view.getByText('原始答案', { exact: true }).waitFor();
    assert.equal((await t.view.locator('.vocab-expected-answer').innerText()).trim(), 'myocardial infarction');
    await t.view.getByRole('button', { name: '我是錯的', exact: true }).waitFor();
    await t.page.waitForTimeout(1100);
    await t.page.keyboard.press('a'); await t.page.keyboard.press('Space');
    assert.equal(await t.view.locator('.vocab-response').isVisible(), true, 'letters and Space do not confirm a different accepted answer');
    await t.page.keyboard.press('Enter'); await t.idle();
    assert.equal(await t.view.locator('.vocab-response').count(), 0, 'Enter confirms the original and continues');
    t.check(); await t.context.close();

    t = await setup('standard', .99, 'offline');
    await t.submit('MI'); await t.idle();
    await t.view.getByText('無法確定，請核對正確答案', { exact: true }).waitFor();
    await t.view.getByText('智慧判讀模型無法載入，請核對正確答案或切換為絕對相同。', { exact: true }).waitFor();
    assert.equal(t.counts().geminiCalls, 0); t.check(); await t.context.close();

    t = await setup('standard', .99, 'wait');
    await t.submit('MI');
    await t.view.getByText('智慧判讀中…', { exact: true }).waitFor();
    assert.equal(await t.answer.isDisabled(), true);
    await t.view.getByRole('button', { name: '取消判讀', exact: true }).click(); await t.idle();
    await t.view.getByText('無法確定，請核對正確答案', { exact: true }).waitFor();
    assert.equal(await t.view.locator('.vocab-response').innerText(), 'MI'); t.check(); await t.context.close();
    console.log('Four-level written grading passed: real MeSH concepts, semantic thresholds, exact normalization, manual correction, unavailable model, cancellation, no Gemini and mobile layout.');
} finally { await browser.close(); }
