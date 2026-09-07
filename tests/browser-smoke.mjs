import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
const questions = [
    { question: '下列關於抽胸水檢查的敘述何者正確？', options: { A: 'Eosinophilia 代表乳糜胸', B: 'pH < 6.5，代表食道破裂' }, answer: 'B', explanation: 'Esophageal rupture 通常伴隨胸水 pH 降低。', origin: 'B10 區段考 第 3 題' },
    { question: 'In real-time PCR, samples A and B have Ct values of 25 and 30. What is the ratio A:B?', answer: ['32:1'], explanation: '每次 PCR 循環，DNA 量加倍，差距為 $2^5 = 32$ 倍。', origin: 'B10 區段考 第 2 題' }
];
const bank = '檢驗醫學區段一｜B10 考古'; const bank2 = '藥理區段一｜B09 考古';
const db = { [bank]: questions, [bank2]: [{ question: '選出正確的敘述。', options: { A: '第一項', B: '第二項', C: '第三項' }, answer: ['A', 'B'] }],
    quizCatalog: { [bank]: { count: 2 }, [bank2]: { count: 1 } },
    mistakes: { 'test-user': { [bank]: { old: { ...questions[0], originalIndex: 0, count: 3, lastMistake: 1788681600000, lastSelection: 'A' }, fill: { ...questions[1], originalIndex: 1, count: 1, lastMistake: 1788595200000 } }, [bank2]: { multi: { question: '選出正確的敘述。', options: { A: '第一項', B: '第二項', C: '第三項' }, answer: ['A', 'B'], originalIndex: 0, count: 2, lastMistake: 1788508800000 } } } },
    progress: { 'test-user': { quizzes: { [bank]: { selectedJson: bank, currentIndex: 0, lastUpdated: 100, allQuestions: questions.map((q, i) => ({ ...q, originalIndex: i, isAnswered: i === 0, isConfirmed: i === 0, isCorrect: i === 0, isFillBlank: !q.options, userSelection: i === 0 ? 'B' : null })) } } } } };
await context.addInitScript(value => { window.__testDatabase = value; }, db);
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
// Fail closed if another module accidentally requests a production backend.
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await mkdir('artifacts/qa', { recursive: true });
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.locator('.unit-card').first().waitFor();
    assert.equal(await page.locator('.unit-card').count(), 2);
    await page.screenshot({ path: 'artifacts/qa/home-desktop.png', fullPage: true });
    await page.locator('#controlsMenuBtn').click();
    await page.locator('#menuAddQuiz').click();
    const dialogBox = await page.locator('#uploadModal .md3-dialog').boundingBox();
    const closeBox = await page.locator('#uploadModal .dialog-close').boundingBox();
    assert.ok(closeBox.x > dialogBox.x + dialogBox.width / 2 && closeBox.x + closeBox.width < dialogBox.x + dialogBox.width);
    assert.ok(closeBox.y >= dialogBox.y && closeBox.y + closeBox.height < dialogBox.y + 70);
    assert.ok(await page.locator('#uploadModal .md3-dialog-actions .modal-close').isVisible());
    await page.screenshot({ path: 'artifacts/qa/upload-dialog-desktop.png', fullPage: true });
    await page.locator('#uploadModal .dialog-close').click();
    await page.locator('#homeMistakes').click();
    await page.locator('.review-card').first().waitFor();
    assert.equal(await page.locator('.review-card').count(), 3);
    assert.equal((await page.locator('#closeMistakeViewBtn').innerText()).trim(), '關閉');
    assert.equal(await page.locator('#mistakeSubject').isVisible(), false);
    await page.locator('#mistakeSubjectTrigger').click();
    await page.screenshot({ path: 'artifacts/qa/notebook-menu-desktop.png', fullPage: true });
    await page.getByRole('option', { name: '檢驗醫學區段一', exact: true }).click();
    assert.equal(await page.locator('.review-card').count(), 2);
    await page.locator('#mistakeSubjectTrigger').click();
    await page.getByRole('option', { name: '全部科目', exact: true }).click();
    await page.locator('#mistakeSortTrigger').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#mistakeSort').inputValue(), 'frequent');
    await page.locator('#mistakeSortTrigger').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#mistakeView').isVisible(), true);
    await page.locator('#mistakeSortTrigger').click();
    await page.getByRole('option', { name: '最近答錯', exact: true }).click();
    assert.equal(await page.locator('.review-answer[open]').count(), 0);
    await page.locator('#mistakeSearch').fill('PCR');
    assert.equal(await page.locator('.review-card').count(), 1);
    await page.locator('#mistakeSearch').fill('');
    await page.locator('.review-answer summary').first().click();
    await page.screenshot({ path: 'artifacts/qa/notebook-desktop.png', fullPage: true });
    // Status changes move the row without deleting history; reversing is available.
    await page.locator('.review-footer button').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.review-card').length === 2);
    await page.locator('[data-mistake-status="mastered"]').click();
    assert.equal(await page.locator('.review-card').count(), 1);
    await page.locator('.review-footer button').first().click();
    await page.locator('[data-mistake-status="active"]').click();
    await page.locator('#mistakeSelectAll').check();
    assert.match(await page.locator('#mistakePracticeBtn').innerText(), /3/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'artifacts/qa/notebook-mobile.png', fullPage: true });
    await page.locator('#mistakeQuizTrigger').click();
    const popupBox = await page.locator('#mistakeQuizListbox').boundingBox();
    assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= 390);
    await page.screenshot({ path: 'artifacts/qa/notebook-menu-mobile.png', fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('#mistakeView').scrollWidth > innerWidth), false);
    await page.evaluate(() => { document.documentElement.classList.add('dark-mode'); document.body.classList.add('dark-mode'); });
    await page.screenshot({ path: 'artifacts/qa/notebook-dark-mobile.png', fullPage: true });
    await page.evaluate(() => { document.documentElement.classList.remove('dark-mode'); document.body.classList.remove('dark-mode'); });
    await page.locator('#mistakePracticeBtn').click();
    await page.locator('.quiz-container').waitFor({ state: 'visible' });
    await page.locator('.option-button[data-option="A"]').click();
    await page.locator('#confirm-btn').click();
    // A second programmatic click must not change counters or the Firebase record.
    await page.locator('#confirm-btn').dispatchEvent('click');
    await page.waitForFunction(bank => window.__testDatabase.mistakes['test-user'][bank].old.count === 4, bank);
    assert.equal(await page.locator('#wrong').innerText(), '1');
    await page.screenshot({ path: 'artifacts/qa/answer-mobile.png', fullPage: true });
    await page.locator('#next-btn').click();
    await page.locator('#fillblank-input').fill('32:1');
    await page.locator('#confirm-btn').click();
    await page.locator('#next-btn').click();
    await page.locator('.option-button[data-option="A"]').click();
    await page.locator('.option-button[data-option="B"]').click();
    await page.locator('#confirm-btn').click();
    await page.locator('#next-btn').click();
    await page.locator('.results-container').waitFor();
    assert.ok((await page.locator('.results-actions button').first().boundingBox()).height >= 48);
    await page.screenshot({ path: 'artifacts/qa/results-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: 'artifacts/qa/results-desktop.png', fullPage: true });
    assert.equal(await page.evaluate(bank => window.__testDatabase.progress['test-user'].quizzes[bank].currentIndex, bank), 0, 'practice must not overwrite normal progress');
    // Reload uses the isolated fixture again. Resume dialog must be offered after a saved answer.
    page.on('dialog', dialog => dialog.accept());
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.unit-card').filter({ hasText: '檢驗醫學' }).click();
    await page.locator('.unit-card').first().click();
    await page.locator('#quizActionResumeBtn').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#quizActionResumeBtn').boundingBox()).height >= 48);
    await page.screenshot({ path: 'artifacts/qa/resume-dialog-desktop.png', fullPage: true });
    await page.locator('#quizActionResumeBtn').click();
    await page.locator('.quiz-container').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#correct').innerText(), '1');
    // Failed writes stay ordered and retry once when the connection returns.
    await page.locator('.quiz-title').click();
    await page.locator('#homeMistakes').click();
    await page.locator('#mistakeSearch').fill('胸水');
    await page.locator('#mistakePracticeBtn').click();
    await page.evaluate(() => { window.__failWrites = true; });
    await page.locator('.option-button[data-option="A"]').click();
    await page.locator('#confirm-btn').click();
    await page.waitForFunction(() => document.getElementById('modal-message').textContent.includes('尚未同步'));
    assert.equal(await page.evaluate(bank => window.__testDatabase.mistakes['test-user'][bank].old.count, bank), 3);
    await page.evaluate(() => { window.__failWrites = false; window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(bank => window.__testDatabase.mistakes['test-user'][bank].old.count === 4, bank);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.equal(await page.evaluate(bank => window.__testDatabase.mistakes['test-user'][bank].old.count, bank), 4);
    // Repeated successful practice moves only this question to mastered.
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('.quiz-title').click();
        await page.locator('#homeMistakes').click();
        await page.locator('#mistakeSearch').fill('胸水');
        await page.locator('#mistakePracticeBtn').click();
        await page.locator('.option-button[data-option="B"]').click();
        await page.locator('#confirm-btn').click();
        await page.waitForFunction(({ bank, count }) => window.__testDatabase.mistakes['test-user'][bank].old.correctStreak === count, { bank, count: attempt + 1 });
    }
    assert.equal(await page.evaluate(bank => window.__testDatabase.mistakes['test-user'][bank].old.status, bank), 'mastered');
    await page.locator('.quiz-title').click();
    await page.evaluate(() => { window.__failReads = ['mistakes/']; });
    await page.locator('#homeMistakes').click();
    await page.waitForFunction(() => document.getElementById('mistakeSummary').textContent.includes('同步失敗'));
    await page.evaluate(() => { window.__failReads = []; });
    await page.locator('#mistakeSummary button').click();
    await page.locator('#mistakeView[aria-busy="false"]').waitFor();
    await page.locator('#closeMistakeViewBtn').click();
    // Catalog rename keeps storage identity and moves bank+catalog together.
    const renamed = await page.evaluate(async bank => {
        const { writeBanks, readCatalog } = await import('/src/services/catalog.js');
        const data = window.__testDatabase[bank];
        await writeBanks({ [bank]: null, '檢驗醫學區段一｜新版 B10': data });
        return (await readCatalog())['檢驗醫學區段一｜新版 B10'].storageKey;
    }, bank);
    assert.equal(renamed, bank);
    assert.equal(await page.evaluate(async () => {
        const { markdown } = await import('/src/shared/content.js');
        const html = markdown('<img src="x" onerror="window.injected=true"><script>alert(1)</script>[unsafe](javascript:alert(1))');
        return /onerror|<script|javascript:/.test(html);
    }), false, 'imported content must not execute scripts');
    // An erratum updates the source bank and the personal snapshot without adding an attempt.
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.unit-card').filter({ hasText: '檢驗醫學' }).click();
    await page.locator('.unit-card').first().click();
    await page.locator('#quizActionResumeBtn').click();
    await page.locator('#errata-btn').click();
    await page.locator('input[name="errataOption"][value="A"]').check();
    await page.locator('#errataSaveBtn').click();
    await page.waitForFunction(bank => window.__testDatabase[bank][0].answer === 'A' && window.__testDatabase.mistakes['test-user'][bank].old.answer === 'A', bank);
    assert.equal(await page.evaluate(bank => window.__testDatabase.mistakes['test-user'][bank].old.count, bank), 3);
    await page.locator('.quiz-title').click();
    await page.locator('.folder-back').click();
    await page.locator('.unit-card').filter({ hasText: '藥理' }).click();
    await page.locator('.unit-card').first().click();
    assert.equal(await page.locator('#quizActionResumeBtn').isVisible(), false);
    assert.ok((await page.locator('#quizActionRestartBtn').boundingBox()).height >= 48);
    await page.screenshot({ path: 'artifacts/qa/start-dialog-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'artifacts/qa/start-dialog-mobile.png', fullPage: true });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#quizActionModal').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: filters, hidden answers, reversible status, selection, mobile overflow, mixed-bank practice, duplicate confirmation, progress isolation, resume, offline retry, mastery and catalog rename.');
} finally { await browser.close(); }
