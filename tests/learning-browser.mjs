import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const fixture = await readFile('tests/fixtures/firebase.js', 'utf8');
const bank = '藥理｜測試';
const questions = [1, 2].map(n => ({
    questionId: `q${n}`,
    revision: 1,
    question: `測試題 ${n}`,
    options: { A: '甲', B: '乙' },
    answer: 'B',
    explanation: '測試詳解',
    taxonomy: { subject: '藥理', topic: '受體' }
}));

await context.addInitScript(({ bank, questions }) => {
    window.__testDatabase = JSON.parse(sessionStorage.getItem('test-db') || 'null') || {
        [bank]: questions,
        quizCatalog: { [bank]: { count: 2 } }
    };
    window.__failWrites = sessionStorage.getItem('fail') === '1';
}, { bank, questions });

await context.route('**/src/services/firebase.js', r => r.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs|generativelanguage/, r => r.abort());

const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());

try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });

    // 1. Verify "自訂測驗" is completely removed from navigation
    assert.equal(await page.locator('.library-shortcuts button').filter({ hasText: '自訂測驗' }).count(), 0);
    assert.equal(await page.locator('#homeLearning').count(), 1);

    // 2. Start quiz from library to produce attempts
    const folder = page.locator('.bank-folder').filter({ hasText: '藥理' });
    await folder.click();
    await page.locator('.bank-card .bank-open').click();
    await page.locator('#quizActionRestartBtn').click();

    // Answer Q1: option A (wrong)
    await page.locator('[data-option="A"]').click();
    await page.locator('#confirm-btn').click();
    assert.equal(await page.locator('#explanation-text').isVisible(), true);
    await page.locator('#next-btn').click();

    // Answer Q2: option B (correct)
    await page.locator('[data-option="B"]').click();
    await page.locator('#confirm-btn').click();
    await page.locator('#next-btn').click();

    // Verify 2 attempts recorded
    await page.waitForFunction(() => Object.keys(window.__testDatabase.learning?.['test-user']?.attempts || {}).length === 2);
    assert.equal(await page.evaluate(() => Object.values(window.__testDatabase.learning['test-user'].attempts).filter(e => e.isCorrect).length), 1);

    // Save state and reload
    await page.evaluate(() => sessionStorage.setItem('test-db', JSON.stringify(window.__testDatabase)));
    await page.reload({ waitUntil: 'networkidle' });

    // 3. Navigate to "學習總覽" page
    if (await page.locator('#sidebarToggle').getAttribute('aria-expanded') === 'false') {
        await page.locator('#sidebarToggle').click();
    }
    await page.getByRole('button', { name: '學習總覽', exact: true }).click();

    // Verify it is a proper page (<main id="learningPage">) and not a floating modal dialog
    await page.locator('#learningPage').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#learningPage').isVisible(), true);
    assert.equal(await page.locator('dialog.learning-dialog[open]').count(), 0);
    assert.equal(await page.locator('.home-content').isVisible(), false);
    assert.equal(await page.locator('#homeLearning').getAttribute('aria-current'), 'page');

    // Verify metrics and heatmap
    const recentMetric = page.locator('#learningPage .panel-metric').filter({ hasText: '近 7 天作答' });
    await recentMetric.waitFor();
    assert.equal(await recentMetric.locator('strong').textContent(), '2');
    assert.equal(await page.locator('#learningPage .panel-heatmap-grid').isVisible(), true);

    await mkdir('artifacts/qa', { recursive: true });
    await page.screenshot({ path: 'artifacts/qa/learning-mobile.png', fullPage: true });

    // Verify "返回題庫" navigation works
    await page.locator('#learningPage').getByRole('button', { name: '返回題庫', exact: true }).click();
    assert.equal(await page.locator('#learningPage').isVisible(), false);
    assert.equal(await page.locator('.home-content').isVisible(), true);
    assert.equal(await page.locator('#homeLibrary').getAttribute('aria-current'), 'page');

    // 4. Privacy menu check
    if (await page.locator('#sidebarToggle').getAttribute('aria-expanded') === 'false') {
        await page.locator('#sidebarToggle').click();
    }
    await page.locator('#controlsMenuBtn').click();
    await page.locator('#menuPrivacy').dispatchEvent('click');
    assert.equal(await page.locator('dialog.learning-dialog[open] .panel-badge', { hasText: '分析已啟用' }).isVisible(), true);
    assert.ok((await page.locator('dialog.learning-dialog[open] .panel-body').textContent()).includes('使用量分析預設啟用'));
    await page.getByRole('button', { name: '關閉', exact: true }).click();

    // 5. Durable retry survives destruction of the page and is idempotent.
    await page.evaluate(async () => {
        sessionStorage.setItem('fail', '1');
        window.__failWrites = true;
        const { recordLearning } = await import('/src/services/learning.js');
        await recordLearning({
            event: {
                eventId: 'offline-event',
                questionId: 'q1',
                questionRevision: 1,
                sessionId: 'offline',
                selectedAnswer: 'A',
                isCorrect: false,
                responseTimeMs: 2000,
                mode: 'study',
                submittedAt: Date.now(),
                sourcePath: '藥理｜測試',
                taxonomy: {}
            },
            snapshot: { question: '測試題 1' },
            quizKey: '藥理｜測試',
            recordPath: 'q1'
        });
    });
    await page.getByText('資料已保存在此裝置，尚未同步', { exact: false }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(async () => (await (await import('/src/services/outbox.js')).storage('outbox', 'getAll')).filter(i => i.kind === 'attempt').length), 1);
    await page.evaluate(() => {
        sessionStorage.removeItem('fail');
        window.__failWrites = false;
        window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(() => !!window.__testDatabase.learning?.['test-user']?.attempts?.['offline-event']);
    await page.evaluate(async () => (await import('/src/services/outbox.js')).flushOutbox());
    assert.equal(await page.evaluate(() => Object.keys(window.__testDatabase.learning['test-user'].attempts).length), 3);

    assert.deepEqual(errors, []);
    console.log('Learning browser passed: removed custom quiz, proper learning page, metrics, return to library, durable retry.');
} finally {
    await browser.close();
}
