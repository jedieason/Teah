import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const fixture = (await readFile('tests/fixtures/firebase.js', 'utf8')).replace('export async function update(path, values) {', `export async function update(path, values) {
    window.__bankWriteAttempts = (window.__bankWriteAttempts || 0) + 1;
    if (window.__writeDelay) await new Promise(resolve => setTimeout(resolve, window.__writeDelay));
    if (window.__failWrites) throw new Error('PERMISSION_DENIED');
`);
const names = ['免疫療法', '抗生素', '抗病毒、抗微菌藥物', '抗腫瘤藥物', '寄生蟲藥物', 'B03 考古', 'B04 考古', 'B05 考古', 'B06 考古', 'B07 考古', 'B08 考古', 'B09 考古', 'B10 考古', 'B11 考古', 'NSAID, Steroid'];
const keys = names.map(title => `藥理區段一｜${title}`), other = '病理區段一｜細胞', old = '_Archive_舊題庫｜練習';
await context.addInitScript(({ keys, other, old }) => {
    const q = { questionId: 'q1', question: '受體作用', options: { A: '甲', B: '乙' }, answer: 'A' };
    const banks = Object.fromEntries([...keys, other, old].map((key, i) => [key, Array.from({ length: i + 1 }, () => q)]));
    window.__testDatabase = { ...banks, quizCatalog: Object.fromEntries(Object.entries(banks).map(([key, qs]) => [key, { count: qs.length, storageKey: key.replace(/^_Archive_/, '') }])),
        progress: { 'test-user': { quizzes: { [keys[0]]: { selectedJson: keys[0], currentIndex: 1, allQuestions: [{ ...q, isAnswered: true }] } }, starred: [q] } },
        mistakes: { 'test-user': { retained: { q } } } };
}, { keys, other, old });
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, route => route.abort());
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const cards = page.locator('.bank-card');
const settled = () => page.waitForFunction(() => document.querySelector('#bankActionForm').getAttribute('aria-busy') !== 'true');
const menuAction = async (title, action) => {
    await page.getByRole('button', { name: `${title}的更多操作`, exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
};
const navigate = async name => {
    if (await page.evaluate(() => innerWidth <= 700) && await page.locator('#sidebarToggle').getAttribute('aria-expanded') === 'false') await page.locator('#sidebarToggle').click();
    await page.getByRole('button', { name, exact: true }).click();
};
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.locator('.bank-folder').filter({ hasText: '藥理區段一' }).click();
    assert.equal(await cards.count(), 15);
    assert.equal(await page.locator('#bankSelectionBar').isVisible(), false);
    // Opening, menu keyboard navigation, dismissal and focus restoration are separate interactions.
    await cards.first().locator('.bank-open').focus(); await page.keyboard.press('Enter');
    await page.locator('#quizActionModal').waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
    const firstMore = cards.first().locator('.bank-more'); await firstMore.click();
    await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.textContent), '刪除題庫');
    await page.keyboard.press('Escape'); assert.equal(await firstMore.evaluate(el => el === document.activeElement), true);
    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/library-grid-desktop.png', fullPage: true });
    await page.getByRole('button', { name: '清單檢視', exact: true }).click();
    assert.equal(await page.locator('.bank-list').count(), 1);
    await page.getByLabel('題庫排序', { exact: true }).selectOption('count');
    assert.match(await cards.first().innerText(), /NSAID, Steroid/);
    await page.locator('#libraryManage').click();
    assert.equal(await page.locator('#bankBatchDelete').isDisabled(), true);
    const check = name => page.getByRole('checkbox', { name: `選取 ${name}`, exact: true });
    await check('免疫療法').check();
    assert.equal(await page.locator('#bankSelectAll').evaluate(el => el.indeterminate), true);
    assert.equal(await page.locator('#bankBatchRename').isEnabled(), true);
    await check('抗生素').check();
    assert.equal(await page.locator('#bankBatchRename').isDisabled(), true);
    assert.equal(await page.locator('.bank-card.is-selected').count(), 2);
    await page.locator('#bankSelectAll').check(); assert.equal(await page.locator('.bank-card.is-selected').count(), 15);
    await page.locator('#bankSelectionClear').click();
    await check('抗生素').check();
    await page.locator('#bankSearch').fill('免疫');
    assert.equal(await cards.count(), 1); assert.match(await page.locator('#bankSelectionCount').innerText(), /0 份/);
    await page.locator('#bankSelectAll').check();
    assert.match(await page.locator('#bankSelectionCount').innerText(), /1 份/);
    await page.locator('#bankSearch').fill(''); assert.match(await page.locator('#bankSelectionCount').innerText(), /0 份/);
    await check('免疫療法').check(); await check('抗生素').check();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/qa/library-selection-desktop.png', fullPage: true });
    await page.locator('#bankBatchDelete').click();
    assert.equal(await page.locator('#bankActionList li').count(), 2);
    assert.match(await page.locator('#archiveConfirmMessage').innerText(), /所有使用者/);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.bank-card.is-selected').count(), 2);
    // Denied writes stay in the dialog, preserve both banks and can be retried once.
    await page.evaluate(() => { window.__failWrites = true; });
    await page.locator('#bankBatchDelete').click(); await page.locator('#archiveActionBtn').click();
    await page.locator('#bankActionError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#bankActionError').innerText(), /權限不足/);
    assert.equal(await page.evaluate(key => !!window.__testDatabase[key], keys[0]), true);
    await page.evaluate(() => { window.__failWrites = false; window.__writeDelay = 250; });
    await page.locator('#archiveActionBtn').click();
    await page.locator('#archiveActionBtn').dispatchEvent('click');
    await page.waitForFunction(() => document.querySelector('#archiveConfirmModal').style.display === 'none');
    assert.equal(await page.evaluate(() => window.__bankWriteAttempts), 2);
    assert.equal(await page.evaluate(key => !!window.__testDatabase[key] || !!window.__testDatabase.quizCatalog[key], keys[0]), false);
    assert.equal(await page.evaluate(() => !!window.__testDatabase.mistakes['test-user'].retained), true);
    assert.equal(await page.evaluate(() => window.__testDatabase.progress['test-user'].starred.length), 1);
    await page.waitForFunction(() => document.querySelectorAll('.bank-card').length === 13);
    await settled();
    await page.locator('#libraryManage').click();
    // Rename validation and collision failure preserve the original content and identity.
    await menuAction('寄生蟲藥物', '重新命名');
    await page.locator('#bankRenameTitle').fill(''); await page.locator('#archiveActionBtn').click();
    assert.match(await page.locator('#bankActionError').innerText(), /請輸入/);
    await page.locator('#bankRenameTitle').fill('抗腫瘤藥物'); await page.locator('#archiveActionBtn').click();
    await page.getByText('此名稱已存在，請使用其他名稱。', { exact: true }).waitFor();
    await page.locator('#bankRenameTitle').fill('寄生蟲藥物（新版）'); await page.locator('#archiveActionBtn').click();
    await page.waitForFunction(() => !!window.__testDatabase.quizCatalog['藥理區段一｜寄生蟲藥物（新版）']);
    await settled();
    assert.equal(await page.evaluate(() => window.__testDatabase.quizCatalog['藥理區段一｜寄生蟲藥物（新版）'].storageKey), keys[4]);
    await page.locator('#libraryManage').click(); await check('B03 考古').check(); await check('B04 考古').check();
    await page.locator('#bankBatchArchive').click(); await page.locator('#archiveActionBtn').click();
    await page.waitForFunction(key => !!window.__testDatabase[`_Archive_${key}`] && !window.__testDatabase[key], keys[5]);
    assert.equal(await page.evaluate(key => window.__testDatabase.quizCatalog[`_Archive_${key}`].storageKey, keys[6]), keys[6]);
    await page.waitForFunction(() => document.querySelectorAll('.bank-card').length === 11);
    await settled();
    // Phone layout retains touch targets, selection actions and an in-bounds menu.
    await page.setViewportSize({ width: 390, height: 844 });
    await check('B05 考古').check(); await check('B06 考古').check();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/qa/library-selection-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const id of ['bankBatchRename', 'bankBatchArchive', 'bankBatchDelete', 'bankSelectionClear']) assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 40);
    await page.locator('#bankBatchDelete').click();
    const actionBox = await page.locator('#archiveActionBtn').boundingBox(); assert.ok(actionBox.y >= 0 && actionBox.y + actionBox.height <= 844);
    await page.screenshot({ path: 'artifacts/qa/library-delete-mobile.png', fullPage: true }); await page.keyboard.press('Escape');
    await page.locator('#libraryManage').click(); await cards.first().locator('.bank-more').click();
    const menuBox = await page.locator('#bankActionMenu').boundingBox(); assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    await page.screenshot({ path: 'artifacts/qa/library-dark-mobile.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark-mode'));
    await navigate('典藏庫');
    await page.locator('.bank-folder').filter({ hasText: '藥理區段一' }).click();
    await menuAction('B03 考古', '還原至題庫'); await page.locator('#archiveActionBtn').click();
    await page.waitForFunction(key => !!window.__testDatabase[key] && !window.__testDatabase[`_Archive_${key}`], keys[5]);
    await settled();
    // Deleting every bank leaves a readable empty catalog, including on reload, with stale caches purged.
    await page.evaluate(async () => {
        const { storage } = await import('/src/services/outbox.js');
        const { readCatalog, changeBanks } = await import('/src/services/catalog.js');
        const catalog = await readCatalog(), names = Object.keys(catalog);
        await storage('cache', 'put', { id: `bank:test-user:${names[0]}`, uid: 'test-user', value: [{ question: 'stale' }] });
        await changeBanks('delete', names);
        window.__emptyCatalog = await readCatalog(); window.__remainingBankCaches = (await storage('cache', 'getAll')).filter(item => item.id.startsWith('bank:'));
    });
    assert.deepEqual(await page.evaluate(() => window.__emptyCatalog), {});
    assert.deepEqual(await page.evaluate(() => window.__remainingBankCaches), []);
    await navigate('題庫'); await page.getByText('目前沒有題庫', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Library browser passed: layouts, sort, keyboard menus, opening, scoped selection, cancel, denied/retried atomic deletion, duplicate prevention, rename validation/identity, batch archive/restore, phone layout, retained history, cache purge and empty catalog.');
} finally { await browser.close(); }
