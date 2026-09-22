import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
    const q = (id, question, source) => ({ questionId: id, question, source, options: { A: '甲', B: '乙' }, answer: 'B', explanation: '測試詳解' });
    const one = q('q1', '受體作用機轉', '藥理區段一｜自主神經');
    const two = q('q2', '心臟藥物作用', '藥理區段一｜心血管');
    const three = q('q3', '細胞病變', '病理區段一｜細胞');
    window.__testDatabase = {
        quizCatalog: { '藥理區段一｜自主神經': { count: 1 }, '藥理區段一｜心血管': { count: 1 }, '病理區段一｜細胞': { count: 1 }, '_Archive_舊題庫｜練習': { count: 1 } },
        '藥理區段一｜自主神經': [one], '藥理區段一｜心血管': [two], '病理區段一｜細胞': [three], '_Archive_舊題庫｜練習': [one],
        progress: { 'test-user': { starred: [one, two, three] } }
    };
});
await context.route('**/src/services/firebase.js', async r => r.fulfill({ contentType: 'text/javascript', body: await readFile('tests/fixtures/firebase.js', 'utf8') }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, r => r.abort());
const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '已收藏', exact: true }).click();
    await page.locator('.collection-unit').first().waitFor();
    assert.equal(await page.locator('.collection-unit').count(), 2);
    assert.equal(await page.locator('#starredModal').count(), 0);
    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/collection-units.png' });
    await page.getByRole('button', { name: '藥理區段一 2 題 · 2 份題庫' }).click();
    assert.equal(await page.locator('.collection-item').count(), 2);
    await page.getByLabel('篩選收藏題庫').selectOption('藥理區段一｜自主神經');
    assert.equal(await page.locator('.collection-item').count(), 1);
    await page.getByRole('button', { name: '受體作用機轉 自主神經' }).click();
    assert.equal(await page.getByText('測試詳解', { exact: true }).isVisible(), false);
    await page.getByText('答案與詳解', { exact: true }).click();
    assert.equal(await page.getByText('測試詳解', { exact: true }).isVisible(), true);
    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/collection-desktop.png' });
    await page.getByRole('button', { name: '關閉詳情' }).click();
    await page.getByLabel('篩選收藏題庫').selectOption('');
    await page.getByLabel('選取 受體作用機轉').check();
    await page.getByLabel('選取 心臟藥物作用').check();
    await page.getByRole('button', { name: '練習所選題目' }).click();
    await page.locator('.quiz-container').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.progress-dot').count(), 2);
    await page.getByRole('button', { name: '返回題庫', exact: true }).click();
    await page.locator('#collectionPage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.collection-item').count(), 2);
    await page.getByRole('button', { name: '取消選取' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '受體作用機轉 自主神經' }).click();
    assert.equal(await page.locator('.collection-list').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: 'artifacts/qa/collection-mobile.png' });
    await page.getByRole('button', { name: '關閉詳情' }).click();
    await page.locator('.collection-item').first().getByRole('button', { name: '取消收藏' }).click();
    await page.waitForFunction(() => window.__testDatabase.progress['test-user'].starred.length === 2);
    await page.getByRole('button', { name: '全部單元' }).click();
    await page.getByLabel('搜尋收藏').fill('細胞');
    assert.equal(await page.locator('.collection-unit').count(), 1);
    await page.getByRole('button', { name: '典藏庫', exact: true }).click();
    await page.locator('#units-grid .unit-card').filter({ hasText: '舊題庫' }).click();
    await page.getByRole('button', { name: '題庫', exact: true }).click();
    await page.getByRole('button', { name: '典藏庫', exact: true }).click();
    await page.getByRole('button', { name: '還原至題庫', exact: true }).waitFor();
    await page.screenshot({ path: 'artifacts/qa/archive-mobile.png' });
    await page.getByRole('button', { name: '還原至題庫', exact: true }).click();
    await page.locator('#archiveActionBtn').click();
    await page.waitForFunction(() => !!window.__testDatabase['舊題庫｜練習'] && !window.__testDatabase['_Archive_舊題庫｜練習']);
    await page.getByText('尚無典藏題庫', { exact: true }).waitFor();
    await page.getByRole('button', { name: '題庫', exact: true }).click();
    await page.locator('#units-grid .unit-card').filter({ hasText: '舊題庫' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('Collection browser passed: unit grouping, source filter, hidden answers, selected practice, return, mobile detail, unstar, search and archive restore.');
} finally { await browser.close(); }
