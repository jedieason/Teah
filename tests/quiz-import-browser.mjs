import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { originalCutoff, originalImport, originalBank, cutoffPrefix, repairResponse } from './fixtures/quiz-repair.js';

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
    await page.locator('#promptModeCategorized').click();
    assert.equal(await page.locator('#promptSubjectInput').isVisible(), true);
    assert.equal(await page.locator('#promptCategorizedToolbar').isVisible(), true);
    assert.ok((await page.locator('#promptCodeBlock').innerText()).includes('本次整理的核心任務：【依指定單元分類映射】'));
    assert.ok((await page.locator('#promptCodeBlock').innerText()).includes('自泌素'));
    await page.locator('#copyPromptBtn').click();
    const copiedCategorized = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copiedCategorized.includes('<subject>藥理學</subject>'));
    assert.ok(copiedCategorized.includes('藥理學｜自泌素'));
    await page.locator('#promptModeSingle').click();
    assert.equal(await page.locator('#promptSubjectInput').isVisible(), false);
    assert.equal(await page.locator('#promptCategorizedToolbar').isVisible(), false);
    await page.locator('#promptUnitInput').fill('抗生素');
    assert.ok((await page.locator('#promptCodeBlock').innerText()).includes('本次僅製作【抗生素】'));
    await page.locator('#promptModeFull').click();
    assert.equal(await page.locator('#promptSubjectInput').inputValue(), '藥理學');
    assert.equal(await page.locator('#promptCategorizedToolbar').isVisible(), false);
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
    assert.match(await page.locator('#importIssueTitle').innerText(), /第 1 份.*第 1 題/);
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

    // Fences alone are removed automatically and never open the repair panel.
    await openImport();
    const wrappedQuestions = [{ ...question, explanation: "保留內容中的 '''json 與 ```json" }];
    const plainQuestions = JSON.stringify(wrappedQuestions);
    for (const fence of ["'''json", '```json']) {
        await page.locator('#pasteJson').fill(fence + '\n' + plainQuestions + '\n' + fence.slice(0, 3));
        assert.equal(await page.locator('#pasteJson').inputValue(), plainQuestions);
        assert.equal(await page.locator('#importSyntaxIssue').isVisible(), false);
        assert.equal(await page.locator('#importTruncationPanel').isVisible(), false);
    }
    await page.locator('#uploadNameInput').fill('移除外層標記');
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadModal .dialog-close').click();

    // Screenshot regression: explanation is cut off; AI repeats the bank from q3.
    await openImport();
    const completedBanks = Array.from({ length: 12 }, (_, i) => ({ title: `接續前置 ${i + 1}`, questions: [question] }));
    const completedQuestions = Array.from({ length: 4 }, (_, i) => ({ ...question, origin: `腫瘤學 第 ${i + 1} 題`, explanation: `第${i + 1}題詳解完整內容` }));
    const repeatedBank = { title: '病理學區段二｜腫瘤學（一）', questions: completedQuestions };
    const expectedRepair = { banks: [...completedBanks, repeatedBank] };
    const completeText = JSON.stringify(expectedRepair, null, 2);
    const cutText = completeText.slice(0, completeText.indexOf('第3題詳解完整內容') + 5);
    await page.locator('#pasteJson').fill("'''json\n" + cutText);
    assert.equal(await page.locator('#pasteJson').inputValue(), cutText);
    assert.match(await page.locator('#importIssueTitle').innerText(), /JSON 內容未完成/);
    assert.doesNotMatch(await page.locator('#importIssueTitle').innerText(), /Markdown/);
    assert.equal(await page.locator('#importRepairMode').inputValue(), 'continuation');
    await page.locator('#importContinuationInput').fill("'''json\n" + JSON.stringify({ ...repeatedBank, questions: completedQuestions.slice(2) }, null, 2) + "\n]}\n'''");
    await page.screenshot({ path: 'artifacts/qa/import-bank-continuation-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#importMergeBtn').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'artifacts/qa/import-bank-continuation-mobile.png', fullPage: true });
    await page.locator('#importMergeBtn').click();
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), false);
    assert.equal(await page.locator('#uploadSummary').innerText(), '共 13 份題庫，16 題');
    assert.deepEqual(JSON.parse(await page.locator('#pasteJson').inputValue()), expectedRepair);
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadModal .dialog-close').click();
    await page.setViewportSize({ width: 1280, height: 900 });

    // Actual supplied question: a banks repair with a formatting-different title/source.
    await openImport();
    await page.locator('#pasteJson').fill(originalCutoff);
    await page.locator('#importCopyPromptBtn').click();
    const actualPrompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(actualPrompt.includes(JSON.stringify(originalBank.title)));
    assert.ok(actualPrompt.includes(cutoffPrefix));
    assert.ok(actualPrompt.includes('第 13 份題庫，第 3 題'));
    const actualResponse = repairResponse();
    actualResponse.banks[0].questions[0].answer = 'A';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#importContinuationInput').fill(JSON.stringify(actualResponse, null, 2));
    await page.locator('#importMergeBtn').click();
    assert.match(await page.locator('#importMergeStatus').innerText(), /answer.*不一致/);
    assert.equal(await page.locator('#pasteJson').inputValue(), originalCutoff);
    const failureBox = await page.locator('#importMergeStatus').boundingBox();
    assert.ok(failureBox.y >= 0 && failureBox.y + failureBox.height <= 844);
    await page.screenshot({ path: 'artifacts/qa/import-fit-conflict-mobile.png', fullPage: true });
    actualResponse.banks[0].questions[0].answer = 'C';
    actualResponse.banks[0].title = '病理學區段二 | 鄭永銘老師—腫瘤學 (Neoplasm) (一)';
    actualResponse.banks[0].questions[0].origin = '鄭永銘老師 ／ 腫瘤學(一) 第3題';
    await page.locator('#importContinuationInput').fill('```json\n' + JSON.stringify(actualResponse, null, 2) + '\n```');
    await page.locator('#importMergeBtn').click();
    assert.deepEqual(JSON.parse(await page.locator('#pasteJson').inputValue()), originalImport);
    assert.match(await page.locator('#importRepairStatus').innerText(), /第 13 份題庫.*第 3 題.*前 12 份題庫.*前 2 題/);
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    const repairedDialogBox = await page.locator('#uploadModal .md3-dialog').boundingBox();
    const repairedConfirmBox = await page.locator('#uploadConfirmBtn').boundingBox();
    assert.ok(repairedConfirmBox.y >= repairedDialogBox.y && repairedConfirmBox.y + repairedConfirmBox.height <= repairedDialogBox.y + repairedDialogBox.height,
        JSON.stringify({ repairedDialogBox, repairedConfirmBox }));
    await page.screenshot({ path: 'artifacts/qa/import-fit-success-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: 'artifacts/qa/import-fit-success-desktop.png' });
    await page.locator('#uploadModal .dialog-close').click();

    // Reproduce the reported bank 13 / question 3 schema error with repeated data.
    await openImport();
    const brokenBatch = { banks: Array.from({ length: 13 }, (_, i) => ({ title: `定位測試 ${i + 1}`, questions: [{ ...question }, { ...question }, { ...question }] })) };
    delete brokenBatch.banks[12].questions[2].question;
    const brokenSource = JSON.stringify(brokenBatch, null, 2);
    await page.locator('#pasteJson').fill('\n  ```json\n' + brokenSource + '\n```');
    assert.equal(await page.locator('#pasteJson').inputValue(), brokenSource);
    assert.match(await page.locator('#importIssueTitle').innerText(), /第 13 份.*第 3 題缺少題目/);
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), true);
    assert.equal(await page.locator('#pasteJson').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#importJsonBackdrop mark').innerText(), '{');
    await page.locator('#importJumpToErrorBtn').click();
    const highlighted = await page.evaluate(() => {
        const input = document.querySelector('#pasteJson');
        const backdrop = document.querySelector('#importJsonBackdrop');
        const mark = backdrop.querySelector('mark').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return { scroll: input.scrollTop, mirrorScroll: backdrop.scrollTop, visible: mark.top >= box.top && mark.bottom <= box.bottom,
            selection: input.value.slice(input.selectionStart, input.selectionStart + 30), color: getComputedStyle(backdrop.querySelector('mark')).color };
    });
    assert.ok(highlighted.scroll > 0);
    assert.equal(highlighted.scroll, highlighted.mirrorScroll);
    assert.equal(highlighted.visible, true);
    assert.match(highlighted.selection, /^{\n\s+"options"/);
    assert.equal(highlighted.color, 'rgb(185, 28, 28)');
    await page.locator('#importCopyPromptBtn').click();
    const schemaPrompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(schemaPrompt.includes('$.banks[12].questions[2].question'));
    assert.ok(schemaPrompt.endsWith(brokenSource));
    await page.evaluate(() => {
        window.__clipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    });
    await page.locator('#importCopyPromptBtn').click();
    await page.waitForFunction(() => document.querySelector('#importMergeStatus').textContent.includes('無法存取剪貼簿'));
    assert.equal(await page.evaluate(() => window.getSelection().toString()), schemaPrompt);
    await page.evaluate(() => { navigator.clipboard.writeText = window.__clipboardWrite; });
    await page.locator('#importTruncationPanel summary').click();
    await page.locator('#importContinuationInput').fill('[]');
    await page.locator('#importMergeBtn').click();
    assert.equal(await page.locator('#pasteJson').inputValue(), brokenSource);
    assert.match(await page.locator('#importMergeStatus').innerText(), /修補未套用.*原始 JSON 已保留/);
    assert.equal(await page.locator('#importContinuationInput').inputValue(), '[]');
    await page.locator('#importContinuationInput').fill('{');
    await page.locator('#importMergeBtn').click();
    assert.equal(await page.locator('#pasteJson').inputValue(), brokenSource);
    await page.locator('#importContinuationInput').fill('');
    await page.screenshot({ path: 'artifacts/qa/import-repair-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#importJumpToErrorBtn').click();
    for (const selector of ['#pasteJson', '#importTruncationPanel', '#importMergeBtn', '#uploadConfirmBtn']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 390, selector + ' overflows mobile width');
    }
    await page.screenshot({ path: 'artifacts/qa/import-repair-mobile.png', fullPage: true });
    brokenBatch.banks[12].questions[2].question = question.question;
    await page.locator('#importContinuationInput').fill('```json\n' + JSON.stringify(brokenBatch) + '\n```');
    await page.locator('#importMergeBtn').click();
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), false);
    assert.equal(await page.locator('#importJsonBackdrop').isVisible(), false);
    assert.equal(await page.locator('#pasteJson').getAttribute('aria-invalid'), 'false');
    assert.equal(await page.locator('#importRepairStatus').isVisible(), true);
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadModal .dialog-close').click();
    await page.setViewportSize({ width: 1280, height: 900 });

    // A failed file import opens the same repair editor and retains its file title.
    await openImport();
    await page.locator('#uploadJson').setInputFiles({ name: '待修補.json', mimeType: 'application/json', buffer: Buffer.from('[{"answer":"A"}]') });
    assert.equal(await page.locator('#pasteJson').isVisible(), true);
    await page.waitForFunction(() => document.querySelector('#uploadNameInput').value === '待修補');
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), true);
    await page.locator('#importContinuationInput').fill(JSON.stringify([question]));
    await page.locator('#importMergeBtn').click();
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadModal .dialog-close').click();

    // A syntax error in minified JSON scrolls horizontally to its red marker.
    await openImport();
    const longSyntax = '  [{"question":' + JSON.stringify('中文 🧬 '.repeat(150)) + ',"answer":}]';
    await page.locator('#pasteJson').fill(longSyntax);
    await page.locator('#importJumpToErrorBtn').click();
    const horizontal = await page.evaluate(() => {
        const input = document.querySelector('#pasteJson');
        const mark = document.querySelector('#importJsonBackdrop mark').getBoundingClientRect();
        const box = input.getBoundingClientRect();
        return { scroll: input.scrollLeft, visible: mark.left >= box.left && mark.right <= box.right };
    });
    assert.ok(horizontal.scroll > 0);
    assert.equal(horizontal.visible, true);
    await page.locator('#pasteJson').fill(JSON.stringify([question]));
    assert.equal(await page.locator('#importJumpToErrorBtn').isVisible(), false);
    await page.locator('#uploadModal .dialog-close').click();

    // Test truncated JSON repair prompt and continuation merging
    await openImport();
    const truncatedText = `{
  "banks": [
    {
      "title": "病理學區段二｜B11 考古",
      "questions": [
        {
          "origin": "出自 B11 考古第 1 題",
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP",
            "C": "RNA",
            "D": "NADH"
          },
          "answer": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    },
    {
      "title": "病理學區段二｜B10 考古",
      "questions": [
        {
          "origin": "出自 B10 考古第 1 題",
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP",
            "C": "RNA",
            "D": "NADH"
          },
          "answ`;
    await page.locator('#pasteJson').fill(truncatedText);
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), true);
    const repairPrompt = await page.locator('#importRepairPrompt').textContent();
    assert.ok(repairPrompt.includes('可獨立 JSON.parse'));
    assert.ok(repairPrompt.includes('出自 B10 考古第 1 題'));
    assert.ok(repairPrompt.endsWith('"answ'));
    await page.locator('#importRepairMode').selectOption('replace');
    assert.ok((await page.locator('#importRepairPrompt').textContent()).includes('完整 JSON'));
    assert.equal(await page.locator('#importRepairInputLabel').innerText(), '完整修補 JSON');
    await page.locator('#importRepairMode').selectOption('continuation');
    await page.locator('#importCopyPromptBtn').click();
    const copiedPrompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copiedPrompt, repairPrompt);
    await page.locator('#importContinuationInput').fill(`er": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    }
  ]
}`);
    await page.locator('#importMergeBtn').click();
    await page.waitForFunction(() => document.querySelector('#uploadSummary')?.textContent.includes('共 2 份題庫'));
    assert.equal(await page.locator('#importTruncationPanel').isVisible(), false);
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['病理學區段二｜B10 考古']);

    // Test malformed JSON diagnostics and auto-repair
    await openImport();
    const malformedText = `'''json
{
  "banks": [
    {
      "title": "病理學｜自動修復測試",
      "questions": [
        {
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP"
          }
          "answer": "B"
        }
      ]
    }
  ]
}
'''`;
    await page.locator('#pasteJson').fill(malformedText);
    assert.equal(await page.locator('#importSyntaxIssue').isVisible(), true);
    assert.equal(await page.locator('#importAutoRepairBtn').isVisible(), true);
    assert.doesNotMatch(await page.locator('#importIssueTitle').innerText(), /Markdown/);
    assert.ok((await page.locator('#pasteJson').inputValue()).startsWith('{'));
    assert.equal(await page.locator('#importJsonBackdrop mark').isVisible(), true);
    await page.locator('#importAutoRepairBtn').click();
    await page.waitForFunction(() => document.querySelector('#uploadSummary')?.textContent.includes('共 1 份題庫'));
    assert.equal(await page.locator('#importSyntaxIssue').isVisible(), false);
    assert.equal(await page.locator('#uploadConfirmBtn').isEnabled(), true);
    await page.locator('#uploadConfirmBtn').click();
    await page.waitForFunction(() => window.__testDatabase['病理學｜自動修復測試']);

    assert.deepEqual(errors, []);
    console.log('Quiz import browser passed: batch/legacy/file imports, bank 13 schema location, red highlighting and scrolling, mobile layout, repair copy/fallback, failed repair preservation, full replacement, continuation, and auto-repair.');
} finally { await browser.close(); }
