import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
    const question = (question, options, explanation = '僅在詳解出現的詞') => ({ question, options, answer: 'B', explanation });
    const first = '藥理區段一｜B11 自主神經', second = '病理區段一｜B10 細胞', archived = '_Archive_舊題庫｜B09';
    const rows = [question('下列何者作用於 **受體**？', { A: 'Acetylcholine receptor', B: 'pH < 6.5，代表食道破裂' }, '答案解析 $2^5 = 32$，詳解可收起。'),
        question('此題沒有搜尋字詞', { A: '全文選項中的受體', B: '另一個選項' }), question('abc', { A: 'bcd', B: 'def' }),
        question('惡意內容 <img src="x" onerror="window.__xss=true">', { A: '安全<script>window.__xss=true</script>', B: '安全文字' }),
        question('公式判讀 $E=mc^2$', { A: '$Na^+$', B: '連字 ﬃ，cafe\u0301' })];
    window.__testDatabase = { quizCatalog: { [first]: { count: rows.length }, [second]: { count: 26 }, [archived]: { count: 1 } },
        [first]: rows, [second]: Array.from({ length: 26 }, (_, i) => question(`細胞受體資料 ${i + 1}`, { A: '鈉離子', B: '鉀離子' })),
        [archived]: [question('典藏專屬受體', { A: 'archive-only', B: '封存選項' })] };
    window.__readPaths = [];
});
const fixture = (await readFile('tests/fixtures/firebase.js', 'utf8'))
    .replace('export async function get(path) {', 'export async function get(path) { window.__readPaths.push(path); if (window.__denyReads?.some(p => path.startsWith(p))) throw Object.assign(new Error("Permission denied"), { code: "PERMISSION_DENIED" }); if (window.__delayReads?.[path]) await new Promise(resolve => setTimeout(resolve, window.__delayReads[path]));')
    .replace('setTimeout(() => callback(user), 0);', 'window.__authCallback = callback; setTimeout(() => callback(user), 0);');
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, route => route.abort());
const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
const cards = page.locator('.question-search-card'), input = page.locator('#bankSearch');
const find = async (query, count) => { await input.fill(query); await page.waitForFunction(n => document.querySelectorAll('.question-search-card').length === n && document.querySelector('#questionSearch').getAttribute('aria-busy') === 'false' && /^(找到 \d+ 題|沒有符合的題目)/.test(document.querySelector('.question-search-status').textContent), count); };
const nav = async name => { if (await page.evaluate(() => innerWidth <= 700) && await page.locator('#sidebarToggle').getAttribute('aria-expanded') === 'false') await page.locator('#sidebarToggle').click(); await page.getByRole('button', { name, exact: true }).click(); };
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => window.__readPaths.some(path => path.includes('｜'))), false, 'no bank downloads before searching');
    await find('CHOLINE', 1);
    assert.match(await cards.first().innerText(), /Acetylcholine receptor/);
    assert.match(await cards.first().innerText(), /符合選項 A/);
    assert.equal(await cards.first().locator('mark').innerText(), 'choline');
    assert.equal(await cards.first().locator('details').getAttribute('open'), null);
    assert.equal(await cards.first().getByText(/答案解析/).count(), 0);
    await cards.first().getByText('答案與詳解', { exact: true }).click();
    await cards.first().getByText(/答案解析/).waitFor({ state: 'visible' });
    await cards.first().getByText('答案與詳解', { exact: true }).click();
    assert.equal(await cards.first().getByText(/答案解析/).isVisible(), false);
    const initialReads = await page.evaluate(() => window.__readPaths.filter(path => path.includes('｜')).length);
    await find('ＰＨ < ６．５', 1);
    assert.equal(await page.evaluate(() => window.__readPaths.filter(path => path.includes('｜')).length), initialReads);
    await find('E=mc', 1); assert.ok(await cards.first().locator('.katex').count() >= 2);
    await find('f', 2);
    const ligature = cards.filter({ hasText: '公式判讀' });
    assert.match(await ligature.locator('.question-search-options').innerText(), /ﬃ/);
    assert.deepEqual(await ligature.locator('mark').allTextContents(), ['ﬃ', 'f'], 'normalization expansions must not duplicate original text');
    await find('café', 1); assert.equal(await cards.first().locator('mark').innerText(), 'cafe\u0301');
    await find('abcd', 0); await find('僅在詳解', 0);
    await find('受體', 20);
    assert.match(await page.locator('.question-search-status').innerText(), /找到 28 題/);
    assert.equal(await page.evaluate(() => window.__readPaths.some(path => path.startsWith('_Archive_'))), false);
    await page.getByRole('button', { name: /顯示更多題目/ }).click(); assert.equal(await cards.count(), 28);
    assert.equal(await cards.first().locator('details').getAttribute('open'), null);
    await mkdir('artifacts/qa', { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'artifacts/qa/search-desktop.png', fullPage: false });
    await find('惡意內容', 1); assert.equal(await page.evaluate(() => !!window.__xss), false);
    await find('archive-only', 0);
    await nav('典藏庫'); await find('archive-only', 1);
    assert.match(await cards.first().innerText(), /典藏專屬受體/);
    await nav('題庫'); await find('archive-only', 0);
    await find('CHOLINE', 1);
    await cards.first().getByRole('button', { name: '練習此題' }).click();
    await page.locator('.quiz-container').waitFor({ state: 'visible' }); assert.equal(await page.locator('.progress-dot').count(), 1);
    await page.getByRole('button', { name: '返回題庫', exact: true }).click();
    await cards.first().waitFor(); assert.equal(await input.inputValue(), 'CHOLINE');
    await input.fill(''); await page.locator('#questionSearch').waitFor({ state: 'hidden' });
    await page.locator('#units-grid .unit-card').filter({ hasText: '藥理區段一' }).click();
    await find('鈉離子', 20); assert.match(await cards.first().innerText(), /病理區段一/, 'search is global even inside a folder');
    await page.setViewportSize({ width: 390, height: 844 });
    await find('CHOLINE', 1); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: 'artifacts/qa/search-mobile.png', fullPage: true });
    await cards.first().getByText('答案與詳解', { exact: true }).click();
    await cards.first().getByText(/答案解析/).waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await input.press('Escape'); assert.equal(await input.inputValue(), ''); assert.equal(await page.locator('#questionSearch').isVisible(), false);
    await page.evaluate(() => { window.__failReads = ['病理區段一｜B10 細胞']; });
    await nav('典藏庫'); await nav('題庫'); await find('鈉離子', 20);
    assert.match(await page.locator('.question-search-status').innerText(), /找到 26 題/);
    await page.evaluate(() => { window.__failReads = []; });

    await page.evaluate(() => { window.__denyReads = ['病理區段一｜B10 細胞']; });
    await nav('典藏庫'); await nav('題庫'); await find('鈉離子', 0);
    assert.match(await page.locator('.question-search-status').innerText(), /搜尋結果尚未完整/);
    await page.evaluate(() => { window.__denyReads = []; });
    await page.getByRole('button', { name: '重試未載入題庫' }).click(); await cards.first().waitFor();
    assert.match(await page.locator('.question-search-status').innerText(), /找到 26 題/);

    await page.evaluate(() => { window.__delayReads = { '藥理區段一｜B11 自主神經': 700, '病理區段一｜B10 細胞': 700 }; });
    await nav('典藏庫'); await nav('題庫'); await input.fill('CHOLINE');
    await page.waitForFunction(() => document.querySelector('#questionSearch').getAttribute('aria-busy') === 'true');
    await nav('典藏庫'); await find('archive-only', 1); await page.waitForTimeout(800);
    assert.equal(await cards.count(), 1); assert.match(await cards.first().innerText(), /典藏專屬受體/);
    await input.fill('');
    await page.locator('#units-grid .unit-card').filter({ hasText: '舊題庫' }).click();
    await page.getByRole('button', { name: '還原至題庫', exact: true }).click(); await page.locator('#archiveActionBtn').click();
    await page.getByText('尚無典藏題庫', { exact: true }).waitFor(); await find('archive-only', 0);
    await nav('題庫'); await find('archive-only', 1);
    assert.equal(await cards.first().locator('details').getAttribute('open'), null);
    await page.evaluate(async () => { const { auth } = await import('/src/services/firebase.js'); auth.currentUser = null; await window.__authCallback(null); });
    await input.fill('受體'); await page.getByText('請先登入以搜尋題目。', { exact: true }).waitFor(); assert.equal(await cards.count(), 0);
    assert.deepEqual(errors, []);
    console.log('Question search browser passed: scope isolation, options, normalization, exact matching, pagination, hidden explanations, XSS, practice/return, folder/mobile, permission/retry, stale reads, archive restore and logout.');
} finally { await browser.close(); }
