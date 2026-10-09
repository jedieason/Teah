import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fixture = await readFile('tests/fixtures/firebase.js', 'utf8');

const b08 = JSON.parse(await readFile('QuestionBank/檢驗醫學區段一｜B08 考古.json', 'utf8'));
const b09 = JSON.parse(await readFile('QuestionBank/檢驗醫學區段一｜B09 考古.json', 'utf8'));
const b10 = JSON.parse(await readFile('QuestionBank/檢驗醫學區段一｜B10 考古.json', 'utf8'));

const key08 = '檢驗醫學區段一｜B08 考古';
const key09 = '檢驗醫學區段一｜B09 考古';
const key10 = '檢驗醫學區段一｜B10 考古';

const testDb = {
    [key08]: b08,
    [key09]: b09,
    [key10]: b10,
    quizCatalog: {
        [key08]: { count: b08.length },
        [key09]: { count: b09.length },
        [key10]: { count: b10.length }
    }
};

await context.addInitScript(({ testDb }) => {
    window.__testDatabase = testDb;
}, { testDb });

await context.route('**/src/services/firebase.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, r => r.abort());

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });

    // Open 檢驗醫學 folder
    const folderCard = page.locator('.unit-card').filter({ hasText: '檢驗醫學區段一' });
    await folderCard.waitFor({ timeout: 10000 });
    await folderCard.click();

    // Click on B08 考古
    const b08Card = page.locator('.unit-card').filter({ hasText: 'B08 考古' });
    await b08Card.waitFor({ timeout: 5000 });
    await b08Card.click();

    // Quiz action modal opens
    const modal = page.locator('#quizActionModal');
    await modal.waitFor({ state: 'visible' });

    const filterSection = page.locator('#quizActionFilterSection');
    await filterSection.waitFor({ state: 'visible' });

    const filterInfo = page.locator('#quizActionFilterInfo');
    await page.waitForFunction(() => {
        const text = document.getElementById('quizActionFilterInfo')?.textContent || '';
        return text.includes('非考古題共 2 題') && text.includes('B08 - B10');
    }, { timeout: 10000 });

    const infoText = await filterInfo.textContent();
    assert.ok(infoText.includes('非考古題共 2 題'), `Expected info text to mention 2 questions, got: ${infoText}`);
    assert.ok(infoText.includes('B08 - B10'), `Expected info text to mention B08 - B10, got: ${infoText}`);

    // Check the "跳過考古題" checkbox
    const checkbox = page.locator('#skipPastExamRepeatsCheckbox');
    assert.equal(await checkbox.isDisabled(), false);
    await checkbox.check();

    // Check count updates to 2 題
    const countEl = page.locator('#quizActionCount');
    assert.equal(await countEl.textContent(), '2 題');

    const statusEl = page.locator('#quizActionStatus');
    assert.equal(await statusEl.textContent(), '非考古題');

    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/dedup-modal.png' });

    // Click "開始測驗"
    const startBtn = page.locator('#quizActionRestartBtn');
    await startBtn.click();

    // Quiz starts
    await page.locator('.quiz-container').waitFor({ state: 'visible' });

    // Quiz title should be "B08 考古 · 非考古題"
    const quizTitle = await page.locator('.quiz-title').textContent();
    assert.ok(quizTitle.includes('非考古題'), `Expected quiz title to contain 非考古題, got: ${quizTitle}`);

    // Progress dots should have exactly 2 dots
    const dotsCount = await page.locator('.progress-dot').count();
    assert.equal(dotsCount, 2, `Expected 2 dots for non-repeated questions, got ${dotsCount}`);

    // Verify first question is the unique filter question (濾出液)
    const q1Text = await page.locator('#question').textContent();
    assert.ok(q1Text.includes('濾出液'), `Expected question 1 to be 濾出液 question, got: ${q1Text}`);

    // Answer Q1
    await page.locator('[data-option="D"]').click();
    await page.locator('#confirm-btn').click();
    await page.locator('#next-btn').click();

    // Verify second question is POCT 痰液 question
    const q2Text = await page.locator('#question').textContent();
    assert.ok(q2Text.includes('POCT') && q2Text.includes('檢體'), `Expected question 2 to be POCT 檢體 question, got: ${q2Text}`);

    await page.screenshot({ path: 'artifacts/qa/dedup-quiz-running.png' });

    assert.deepEqual(errors, []);
    console.log('Exam dedup browser test passed: modal display, checkbox toggle, count calculation, year range (B08 - B10), and quiz session execution.');
} finally {
    await browser.close();
}
