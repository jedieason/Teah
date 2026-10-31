import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const fixture = (await readFile('tests/fixtures/firebase.js', 'utf8')).replace('export async function update(path, values) {', `export async function update(path, values) {
    window.__bankWriteAttempts = (window.__bankWriteAttempts || 0) + 1;
    window.__lastUpdatedValues = values;
`);

const names = ['免疫療法', '抗生素'];
const keys = names.map(title => `藥理區段一｜${title}`);
await context.addInitScript(({ keys }) => {
    const q1 = { questionId: 'q1', question: '受體作用機轉', options: { A: '甲', B: '乙' }, answer: 'A', explanation: '詳解 1' };
    const q2 = { questionId: 'q2', question: '抗體結構與功能', options: { A: '丙', B: '丁' }, answer: 'B', explanation: '詳解 2' };
    const banks = {
        [keys[0]]: [q1, q2],
        [keys[1]]: [q1]
    };
    window.__testDatabase = {
        ...banks,
        quizCatalog: Object.fromEntries(Object.entries(banks).map(([k, qs]) => [k, { count: qs.length, storageKey: k }])),
        progress: { 'test-user': { quizzes: {} } },
        mistakes: { 'test-user': {} }
    };
}, { keys });

await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, route => route.abort());

const page = await context.newPage();
const errors = [];
page.on('pageerror', err => errors.push(err.message));

try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.locator('.bank-folder').filter({ hasText: '藥理區段一' }).click();

    const firstCard = page.locator('.bank-card').first();
    await firstCard.locator('.bank-more').click();

    // Check "編輯題目" menu item exists and click it
    const editContentMenuItem = page.getByRole('menuitem', { name: '編輯題目' });
    assert.equal(await editContentMenuItem.isVisible(), true);
    await editContentMenuItem.click();

    // Verify content editor modal opened
    const modal = page.locator('#bankContentEditModal');
    await modal.waitFor({ state: 'visible' });

    // Verify textarea has unit JSON
    const textarea = page.locator('#bankContentEditTextarea');
    await page.waitForFunction(() => {
        const val = document.getElementById('bankContentEditTextarea')?.value;
        return val && val.includes('受體作用機轉');
    });

    let currentVal = await textarea.inputValue();
    assert.match(currentVal, /受體作用機轉/);
    assert.match(currentVal, /抗體結構與功能/);
    assert.equal(await page.locator('#bankEditMetaInfo').textContent(), '共 2 題');

    // Switch to single question mode
    await page.locator('#bankEditScopeSingle').click();
    assert.equal(await page.locator('#bankEditQuestionPickerWrap').isVisible(), true);
    assert.equal(await page.locator('#bankEditMetaInfo').textContent(), '第 1 / 2 題');

    // Textarea now contains only question 1
    currentVal = await textarea.inputValue();
    assert.match(currentVal, /受體作用機轉/);
    assert.doesNotMatch(currentVal, /抗體結構與功能/);

    // Switch to question 2 via dropdown
    await page.locator('#bankEditQuestionSelect').selectOption('1');
    currentVal = await textarea.inputValue();
    assert.match(currentVal, /抗體結構與功能/);
    assert.doesNotMatch(currentVal, /受體作用機轉/);

    // Modify question 2
    const parsedQ2 = JSON.parse(currentVal);
    parsedQ2.question = '抗體結構與功能 (已修改)';
    await textarea.fill(JSON.stringify(parsedQ2, null, 2));

    // Click format button
    await page.locator('#bankEditFormatBtn').click();
    assert.equal(await page.locator('#bankContentEditError').isVisible(), false);

    // Save
    await page.locator('#bankContentEditSaveBtn').click();

    // Modal closes after save
    await modal.waitFor({ state: 'hidden' });

    // Verify that window.__lastUpdatedValues contains the updated bank with revision bumped
    const updatedBanks = await page.evaluate(() => window.__lastUpdatedValues);
    assert.ok(updatedBanks, 'Database update was called');
    const updatedList = updatedBanks[keys[0]];
    assert.equal(updatedList.length, 2);
    assert.equal(updatedList[1].question, '抗體結構與功能 (已修改)');
    assert.equal(updatedList[1].questionId, 'q2');
    assert.equal(updatedList[1].revision, 2);

    // Test entry from quiz action modal
    await firstCard.locator('.bank-open').click();
    const actionModal = page.locator('#quizActionModal');
    await actionModal.waitFor({ state: 'visible' });

    const actionEditBtn = page.locator('#quizActionEditContentBtn');
    assert.equal(await actionEditBtn.isVisible(), true);
    await actionEditBtn.click();

    await actionModal.waitFor({ state: 'hidden' });
    await modal.waitFor({ state: 'visible' });
    await page.locator('#bankContentEditCloseBtn').click();
    await modal.waitFor({ state: 'hidden' });

    // Test folder level three-dots: "編輯整個題庫"
    // Navigate back to folder level
    await page.locator('.folder-back').click();
    await page.locator('.bank-folder').waitFor({ state: 'visible' });

    const folderCard = page.locator('.bank-folder').filter({ hasText: '藥理區段一' });
    await folderCard.locator('.bank-more').click();

    const editBankMenuItem = page.getByRole('menuitem', { name: '編輯整個題庫' });
    assert.equal(await editBankMenuItem.isVisible(), true);
    await editBankMenuItem.click();

    await modal.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#bankEditScopeBank').getAttribute('aria-selected'), 'true');
    await page.waitForFunction(() => {
        const val = document.getElementById('bankContentEditTextarea')?.value;
        return val && val.includes('免疫療法') && val.includes('抗生素');
    });

    const batchVal = await textarea.inputValue();
    assert.match(batchVal, /"banks"/);
    assert.match(batchVal, /免疫療法/);
    assert.match(batchVal, /抗生素/);
    assert.equal(await page.locator('#bankEditMetaInfo').textContent(), '共 2 份題庫 · 3 題');

    // Switch to unit mode from folder batch
    await page.locator('#bankEditScopeAll').click();
    assert.equal(await page.locator('#bankEditUnitPickerWrap').isVisible(), true);
    const unitSelectVal = await page.locator('#bankEditUnitSelect').inputValue();
    assert.equal(unitSelectVal, '0');

    // Switch back to bank mode, edit, and save
    await page.locator('#bankEditScopeBank').click();
    const modifiedBatch = JSON.parse(batchVal);
    modifiedBatch.banks[0].questions[0].question = '受體作用機轉 (整個題庫編輯)';
    await textarea.fill(JSON.stringify(modifiedBatch, null, 2));
    await page.locator('#bankContentEditSaveBtn').click();
    await modal.waitFor({ state: 'hidden' });

    const finalUpdated = await page.evaluate(() => window.__lastUpdatedValues);
    assert.ok(finalUpdated, 'Database update was called');
    assert.equal(finalUpdated[keys[0]][0].question, '受體作用機轉 (整個題庫編輯)');

    assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
    console.log('Content editor browser test passed: modal open, unit/single switch, JSON edit, revision increment, quizActionModal trigger, and folder-level entire bank edit.');
} finally {
    await browser.close();
}
