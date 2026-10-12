import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const question = { question: '測試單選', options: { A: '甲', B: '乙' }, answer: 'A', explanation: '詳解', origin: 'B11 第 1 題' };
const db = { quizCatalog: { 既有題庫: { count: 1 } }, 既有題庫: [question] };
await context.addInitScript(value => { window.__testDatabase = value; }, db);
await context.route('**/src/services/firebase.js', route => readFile('tests/fixtures/firebase.js', 'utf8').then(body => route.fulfill({ contentType: 'text/javascript', body })));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const bankQuestions = [question, { question: '測試是非', options: { T: 'True', F: 'False' }, answer: 'T' },
    { question: '測試多選', options: { A: '甲', B: '乙' }, answer: ['A', 'B'] }, { question: '測試填空', answer: ['細胞壁'] }];
const batch = { banks: Array.from({ length: 10 }, (_, i) => ({ title: `藥理學｜B${String(11 - i).padStart(2, '0')} 考古`, questions: bankQuestions })) };
const openImport = async () => {
    await page.locator('#controlsMenuBtn').click(); await page.locator('#menuAddQuiz').click();
};
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.locator('#controlsMenuBtn').click(); await page.locator('#menuContribute').click();
    assert.equal(await page.locator('#copyPromptBtn').isDisabled(), true);
    assert.equal(await page.getByLabel('科目名稱', { exact: true }).isVisible(), true);
    await page.getByLabel('科目名稱', { exact: true }).fill('藥理學');
    assert.ok((await page.locator('#promptSubjectInput').boundingBox()).height < 60);
    await page.locator('#copyPromptBtn').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copied.includes('<subject>藥理學</subject>'));
    assert.ok(copied.includes('藥理學｜抗生素'));
    assert.equal(JSON.parse(copied.match(/```json\n([\s\S]*?)\n```/)[1]).banks.length, 3);
    await page.locator('#promptModeSingle').click();
    assert.equal(await page.locator('#promptSubjectInput').isVisible(), false);
    await page.locator('#promptUnitInput').fill('抗生素');
    assert.ok((await page.locator('#promptCodeBlock').innerText()).includes('本次僅製作【抗生素】'));
    await page.locator('#promptModeFull').click();
    assert.equal(await page.locator('#promptSubjectInput').inputValue(), '藥理學');
    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/multi-bank-prompt-desktop.png', fullPage: true });
    await page.locator('#contributeGoUploadBtn').click();
    assert.equal(await page.locator('#uploadConfirmBtn').isDisabled(), true);
    await page.locator('#pasteJson').fill('```json\n' + JSON.stringify(batch) + '\n```');
    assert.equal(await page.locator('#uploadNameInput').isVisible(), false);
    assert.equal(await page.locator('#uploadBankList input').count(), 10);
    assert.equal(await page.locator('#uploadSummary').innerText(), '共 10 份題庫，40 題');
    const firstTitle = page.getByLabel('第 1 份題庫標題', { exact: true });
    await firstTitle.fill(batch.banks[1].title);
    assert.equal(await page.locator('#uploadConfirmBtn').isDisabled(), true);
    assert.match(await page.locator('#uploadError').innerText(), /重複/);
    await firstTitle.fill('藥理學/抗生素');
    assert.equal(await page.locator('#uploadConfirmBtn').isDisabled(), true);
    await firstTitle.fill('');
    assert.match(await page.locator('#uploadError').innerText(), /第 1 份/);
    await firstTitle.fill('藥理學｜抗生素');
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.screenshot({ path: 'artifacts/qa/batch-import-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#importBankTitle9').fill('藥理學｜自律神經');
    const lastBox = await page.locator('#importBankTitle9').boundingBox();
    assert.ok(lastBox.x >= 0 && lastBox.x + lastBox.width <= 390);
    const confirmBox = await page.locator('#uploadConfirmBtn').boundingBox();
    assert.ok(confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= 844);
    await page.screenshot({ path: 'artifacts/qa/batch-import-mobile.png', fullPage: true });
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase.quizCatalog['藥理學｜自律神經']);
    const saved = await page.evaluate(() => window.__testDatabase);
    assert.equal(Object.keys(saved.quizCatalog).length, 11);
    assert.equal(saved['藥理學｜抗生素'].length, 4);
    assert.deepEqual(saved['藥理學｜抗生素'].map(q => q.answer), bankQuestions.map(q => q.answer));
    assert.ok(saved['藥理學｜抗生素'].every(q => /^q_/.test(q.questionId)));
    assert.equal(saved[batch.banks[0].title], undefined);
    assert.equal(saved['藥理學｜B09 考古'].length, 4);
    assert.equal(saved['藥理學｜B9 考古'], undefined);
    await page.setViewportSize({ width: 1280, height: 900 });

    // A collision must fail before any bank is written; the edited retry saves all.
    await openImport();
    await page.locator('#pasteJson').fill(JSON.stringify({ banks: [
        { title: '新批次', questions: [question] }, { title: '既有題庫', questions: [question] }
    ] }));
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => document.querySelector('#modal-message')?.textContent.includes('已存在'));
    assert.equal(await page.evaluate(() => !!window.__testDatabase['新批次']), false);
    await page.getByLabel('第 2 份題庫標題', { exact: true }).fill('新批次二');
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['新批次二']);

    // Invalid batch content cannot reuse a previous valid preview.
    await openImport();
    await page.locator('#pasteJson').fill(JSON.stringify({ banks: [{ title: '無效題庫', questions: [{ ...question, answer: 'C' }] }] }));
    assert.equal(await page.locator('#uploadConfirmBtn').isDisabled(), true);
    assert.match(await page.locator('#uploadError').innerText(), /第 1 份.*第 1 題/);
    await page.locator('#pasteJson').fill(JSON.stringify([question]));
    await page.locator('#uploadNameInput').fill('單份陣列');
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['單份陣列']);

    // The same batch JSON is also supported in a file, including editable titles.
    await openImport();
    await page.locator('#uploadJson').setInputFiles({ name: 'batch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ banks: [{ title: '檔案批次', questions: [question] }] })) });
    await page.getByLabel('第 1 份題庫標題', { exact: true }).fill('檔案批次改名');
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['檔案批次改名']);
    await openImport();
    await page.locator('#uploadJson').setInputFiles(['B11', 'B10'].map(name => ({ name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([question])) })));
    await page.getByLabel('第 2 份題庫標題', { exact: true }).waitFor();
    await page.locator('#uploadNameInput').fill('病理學');
    assert.equal(await page.getByLabel('第 1 份題庫標題', { exact: true }).inputValue(), '病理學｜B11');
    await page.getByLabel('第 2 份題庫標題', { exact: true }).fill('病理學｜發炎');
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['病理學｜發炎']);
    assert.deepEqual(errors, []);
    console.log('Quiz import browser passed: subject + copied batch schema, 10 banks/40 questions, mobile title edits, validation, collision retry, legacy arrays and multi-file imports.');
} finally { await browser.close(); }
