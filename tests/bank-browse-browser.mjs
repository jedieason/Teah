import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');

const bankKey = '藥理區段一｜抗生素';
const sampleQuestions = [
    {
        question: '下列關於青黴素（Penicillin）的敘述，何者正確？',
        options: { A: '抑制細菌細胞壁合成', B: '抑制 50S 核糖體', C: '抑制 DNA 回旋酶', D: '阻斷葉酸合成' },
        answer: 'A',
        explanation: 'Penicillin 結合至 PBP，抑制 transpeptidation，阻斷細胞壁合成。',
        origin: '110 年藥理考題'
    },
    {
        question: '關於四環黴素（Tetracycline）的禁忌症何者正確？',
        options: { A: '孕婦與八歲以下兒童禁用', B: '可用於孕婦', C: '不影響骨骼牙齒', D: '高血壓禁用' },
        answer: 'A',
        explanation: 'Tetracycline 會沈積於發育中骨骼與牙齒，造成牙齒黃染。',
        origin: '109 年藥理考題'
    },
    {
        question: 'Vancomycin 主要針對何種菌種？',
        options: { A: '革蘭氏陰性菌', B: '革蘭氏陽性菌', C: '黴菌', D: '病毒' },
        answer: 'B',
        explanation: 'Vancomycin 阻斷 D-Ala-D-Ala，對革蘭氏陽性菌有效。'
    }
];

const db = {
    [bankKey]: sampleQuestions,
    quizCatalog: {
        [bankKey]: { count: sampleQuestions.length, storageKey: bankKey }
    },
    progress: {
        'test-user': {
            quizzes: {},
            starred: []
        }
    },
    mistakes: {
        'test-user': {}
    }
};

await context.addInitScript(value => { window.__testDatabase = value; }, db);
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());

const page = await context.newPage();
const errors = [];
page.on('pageerror', err => errors.push(err.message));

try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });

    // Click on pharma folder
    const folder = page.locator('.bank-folder').filter({ hasText: '藥理區段一' });
    await folder.waitFor({ state: 'visible' });
    await folder.click();

    // Click on '抗生素' bank card to open quiz action modal
    const card = page.locator('.bank-card').filter({ hasText: '抗生素' });
    await card.waitFor({ state: 'visible' });
    await card.locator('.bank-open').click();

    // Verify quiz action modal is visible
    const modal = page.locator('#quizActionModal');
    await modal.waitFor({ state: 'visible' });

    // Verify '瀏覽題目' button exists and is visible
    const browseBtn = page.locator('#quizActionBrowseBtn');
    assert.equal(await browseBtn.isVisible(), true);
    assert.equal(await browseBtn.textContent(), '瀏覽題目');

    // Click '瀏覽題目'
    await browseBtn.click();

    // Verify quiz action modal is hidden and bank browse view is visible
    await modal.waitFor({ state: 'hidden' });
    const browseView = page.locator('#bankBrowseView');
    await browseView.waitFor({ state: 'visible' });

    // Check title and question count
    assert.match(await page.locator('#bankBrowseSubject').textContent(), /藥理區段一/);
    assert.match(await page.locator('#bankBrowseTitle').textContent(), /抗生素/);
    assert.match(await page.locator('#bankBrowseCount').textContent(), /共 3 題/);

    // Single question mode: default is mode-single
    assert.equal(await browseView.evaluate(el => el.classList.contains('mode-single')), true);
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 1 / 3 題');
    assert.equal(await page.locator('#bankBrowsePrevBtn').isDisabled(), true);
    assert.equal(await page.locator('#bankBrowseNextBtn').isDisabled(), false);

    // Verify question 1 content and that answer option A is highlighted
    const q1Card = page.locator('.bank-browse-card').first();
    assert.equal(await q1Card.isVisible(), true);
    assert.match(await q1Card.locator('.review-question').textContent(), /青黴素/);
    const correctOpt = q1Card.locator('.review-option.is-answer');
    assert.equal(await correctOpt.count(), 1);
    assert.match(await correctOpt.textContent(), /抑制細菌細胞壁合成/);
    assert.match(await correctOpt.textContent(), /✓ 正確/);

    // Verify explanation is visible
    assert.match(await q1Card.locator('.review-explanation').textContent(), /Penicillin 結合至 PBP/);

    // Click '下一題' (Next)
    await page.locator('#bankBrowseNextBtn').click();
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 2 / 3 題');
    assert.equal(await page.locator('#bankBrowsePrevBtn').isDisabled(), false);
    const q2Card = page.locator('.bank-browse-card').nth(1);
    assert.equal(await q2Card.isVisible(), true);
    assert.match(await q2Card.locator('.review-question').textContent(), /四環黴素/);

    // Flip to question 3
    await page.locator('#bankBrowseNextBtn').click();
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 3 / 3 題');
    assert.equal(await page.locator('#bankBrowseNextBtn').isDisabled(), true);
    assert.equal(await page.locator('#bankBrowseNextBtn').textContent(), '已到最後一題');

    // Flip back using '上一題' (Prev)
    await page.locator('#bankBrowsePrevBtn').click();
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 2 / 3 題');

    // Test keyboard arrow keys
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 3 / 3 題');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#bankBrowseCurrentPage').textContent(), '第 2 / 3 題');

    // Switch to List mode
    await page.locator('#bankBrowseTabList').click();
    assert.equal(await browseView.evaluate(el => el.classList.contains('mode-list')), true);
    assert.equal(await page.locator('#bankBrowseBottomBar').isVisible(), false);
    // All cards should now be visible in list view
    const allCards = page.locator('.bank-browse-card');
    assert.equal(await allCards.count(), 3);
    assert.equal(await allCards.nth(0).isVisible(), true);
    assert.equal(await allCards.nth(1).isVisible(), true);
    assert.equal(await allCards.nth(2).isVisible(), true);

    // Test search filter
    await page.locator('#bankBrowseSearch').fill('Vancomycin');
    const filteredCards = page.locator('.bank-browse-card');
    assert.equal(await filteredCards.count(), 1);
    assert.match(await filteredCards.first().textContent(), /Vancomycin/);

    // Clear search
    await page.locator('#bankBrowseSearch').fill('');
    assert.equal(await page.locator('.bank-browse-card').count(), 3);

    // Star question
    const starBtn = page.locator('.bank-browse-card').first().locator('.review-star-btn');
    assert.equal(await starBtn.evaluate(el => el.classList.contains('active')), false);
    await starBtn.click();
    assert.equal(await starBtn.evaluate(el => el.classList.contains('active')), true);

    // Close view
    await page.locator('#closeBankBrowseBtn').click();
    await browseView.waitFor({ state: 'hidden' });

    assert.deepEqual(errors, []);
    console.log('Bank browse browser test passed successfully!');
} finally {
    await browser.close();
}
