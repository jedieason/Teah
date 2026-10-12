import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck } from '../src/features/flashcard/model.js';

const deck = prepareDeck({ title: '桌面換卡動畫', cards: [
    { term: 'apple', definition: '蘋果' }, { term: 'banana', definition: '香蕉' },
    { term: 'grape', definition: '葡萄' }, { term: 'pear', definition: '梨' }
] });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
await context.addInitScript(data => { window.__testDatabase = JSON.parse(sessionStorage.getItem('transition-db') || JSON.stringify(data)); }, { quizCatalog: {}, flashcard: { 'test-user': { sets: { [deck.id]: deck } } } });
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
const view = page.locator('#flashcardPage'), stage = view.locator('.vocab-flip');
const progress = view.getByRole('progressbar', { name: '字卡瀏覽進度' });
const idle = () => page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
async function open() {
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.locator('#tabFlashcard').click();
    await view.getByRole('button', { name: deck.title, exact: true }).click();
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click(); await idle();
}
async function transition(button, direction) {
    await view.getByRole('button', { name: button, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.vocab-flip')?.getAnimations().length > 0);
    const transforms = await stage.evaluate(element => {
        const animation = element.getAnimations()[0]; animation.pause(); animation.currentTime = 45;
        return animation.effect.getKeyframes().map(frame => frame.transform);
    });
    assert.match(transforms[0], new RegExp(`translateX\\(${direction * 18}%\\) rotateY\\(${direction * -14}deg\\)`));
    assert.equal(await stage.locator('.front').getAttribute('aria-hidden'), 'false', 'new card starts on the front');
    assert.equal(await stage.locator('.back').getAttribute('aria-hidden'), 'true');
    return () => stage.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
}
async function amount(expected) {
    assert.equal(await progress.getAttribute('aria-valuenow'), String(expected));
    assert.equal(await progress.getAttribute('aria-valuemax'), '4');
    await progress.locator('i').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const ratio = await progress.locator('i').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m11);
    assert.ok(Math.abs(ratio - expected / 4) < .001);
}
await mkdir('artifacts/qa', { recursive: true });
try {
    await open(); await amount(0);
    await stage.click(); await idle(); await stage.locator('.vocab-flip-inner').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    let finish = await transition('下一張字卡', 1);
    await page.screenshot({ path: 'artifacts/qa/flashcard-desktop-transition.png' });
    await finish(); await idle(); await amount(1);
    assert.equal(await stage.locator('.front .vocab-face-text').innerText(), 'banana');
    assert.equal(await view.evaluate(element => element.scrollWidth > element.clientWidth), false);
    await page.screenshot({ path: 'artifacts/qa/flashcard-desktop-progress.png' });
    finish = await transition('上一張字卡', -1); await finish(); await idle(); await amount(0);
    await page.keyboard.press('ArrowRight'); await idle(); await amount(1);
    await page.evaluate(async () => {
        await (await import('/src/features/flashcard/service.js')).flushOutbox();
        sessionStorage.setItem('transition-db', JSON.stringify(window.__testDatabase));
    });
    await open(); await amount(1);
    assert.equal(await stage.evaluate(element => element.getAnimations().length), 0, 'resume does not animate');
    await view.locator('.vocab-flash-controls').getByLabel('追蹤進度', { exact: true }).check(); await idle();
    await view.getByRole('button', { name: '知道了 →', exact: true }).click(); await idle(); await amount(2);
    finish = await transition('撤銷上一張分類', -1); await finish(); await idle(); await amount(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await view.getByRole('button', { name: '← 還在學習', exact: true }).click(); await idle(); await amount(2);
    assert.equal(await stage.evaluate(element => element.getAnimations().length), 0);
    await view.locator('.vocab-flash-controls').getByLabel('追蹤進度', { exact: true }).uncheck(); await idle();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await view.locator('.vocab-flash-progress').isVisible(), false, 'progress is desktop only');
    await page.keyboard.press('ArrowRight'); await idle();
    assert.equal(await stage.evaluate(element => element.getAnimations().length), 0, 'mobile has no desktop entrance');
    await page.setViewportSize({ width: 1440, height: 1024 }); await amount(3);
    await page.keyboard.press('ArrowRight'); await idle(); await amount(4);
    await view.getByRole('heading', { name: '本輪字卡完成', exact: true }).waitFor();
    await view.getByRole('button', { name: '重新開始 Flashcards', exact: true }).click(); await idle(); await amount(0);
    assert.equal(await stage.evaluate(element => element.getAnimations().length), 0);
    assert.deepEqual(errors, []);
    console.log('Desktop card transitions, progress, resume, undo, completion, reduced motion and mobile isolation passed.');
} catch (error) {
    await page.screenshot({ path: 'artifacts/qa/flashcard-desktop-transition-failure.png' }); throw error;
} finally { await browser.close(); }
