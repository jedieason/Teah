import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck } from '../src/features/flashcard/model.js';

const deck = prepareDeck({ title: '手機滑動練習', cards: [
    { term: 'apple', definition: Array.from({ length: 24 }, (_, i) => `第 ${i + 1} 行：蘋果是水果。`).join('\n') },
    { term: 'banana', definition: '香蕉' }, { term: 'grape', definition: '葡萄' }, { term: 'pear', definition: '梨' }
] });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, hasTouch: true });
await context.addInitScript(data => { window.__testDatabase = data; }, { quizCatalog: {}, learning: { 'test-user': {} }, mistakes: { 'test-user': {} }, flashcard: { 'test-user': { sets: { [deck.id]: deck } } } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage(); page.setDefaultTimeout(12000);
const cdp = await context.newCDPSession(page), errors = [];
page.on('pageerror', error => errors.push(error.message));
const view = page.locator('#flashcardPage'), stage = view.locator('.vocab-flip');
const idle = () => page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true');
const state = async () => {
    await page.evaluate(async () => (await import('/src/features/flashcard/service.js')).flushOutbox());
    return page.evaluate(id => window.__testDatabase.flashcard['test-user'].study[id], deck.id);
};
const position = async () => (await state()).sessions.flash.index;
let start;
async function touchStart() {
    const box = await stage.boundingBox(); start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
}
async function touchMove(x, y = 0) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + x, y: start.y + y, id: 1 }] });
}
async function touchEnd() {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true' && !document.querySelector('.vocab-flip.swipe-dragging,.vocab-flip.swipe-exiting'));
}
async function swipe(x) { await touchStart(); await touchMove(x / 2); await touchMove(x); await touchEnd(); }
async function mobileLayout(width, height) {
    await page.setViewportSize({ width, height });
    const left = await view.locator('.vocab-mobile-count.error').boundingBox();
    const count = await view.locator('.vocab-study-title').boundingBox();
    const right = await view.locator('.vocab-mobile-count.success').boundingBox();
    assert.ok(left.x + left.width <= count.x && count.x + count.width <= right.x, 'learning counters flank the title and card number as one group');
    assert.ok(Math.abs(left.y + left.height / 2 - count.y - count.height / 2) < 1);
    assert.ok(Math.abs(right.y + right.height / 2 - count.y - count.height / 2) < 1);
    assert.ok(Math.abs(count.x + count.width / 2 - width / 2) < 1);
    assert.equal(await view.locator('.vocab-flash-navigation').isVisible(), false);
    assert.equal(await view.evaluate(element => element.scrollWidth > element.clientWidth), false);
}
await mkdir('artifacts/qa', { recursive: true });
try {
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    await view.getByRole('button', { name: deck.title, exact: true }).click();
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click(); await idle();
    await view.locator('.vocab-flash-controls').getByLabel('追蹤進度', { exact: true }).check(); await idle();
    assert.equal(await view.locator('.vocab-mobile-count').first().isVisible(), false);
    assert.equal(await view.locator('.vocab-flash-navigation').isVisible(), true);
    assert.equal(await view.locator('.vocab-flash-preview').isVisible(), false);
    await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-desktop.png' });
    await mobileLayout(320, 568); await mobileLayout(390, 844); await mobileLayout(700, 900); await mobileLayout(390, 844);
    await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-mobile.png' });
    await touchStart(); await touchMove(40);
    await stage.locator('.vocab-swipe-known').waitFor({ state: 'visible' });
    assert.ok(await stage.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41 > 35), 'card follows the finger before release');
    await touchEnd();
    await page.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.vocab-flip')).transform).m41) < .1);
    assert.equal(await position(), 0); assert.equal((await state()).sessions.flash.flipped, false, 'short drag must not flip');
    assert.equal(Object.values((await state()).events || {}).filter(event => event.kind === 'flash').length, 0);
    const box = await stage.boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await idle();
    assert.equal((await state()).sessions.flash.flipped, true, 'tap still flips');
    await stage.locator('.vocab-flip-inner').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    await stage.locator('.back').evaluate(element => { element.scrollTop = 0; });
    await touchStart(); await touchMove(0, -50); await touchMove(0, -120); await touchEnd();
    await page.waitForFunction(() => document.querySelector('.vocab-face.back').scrollTop > 0);
    assert.equal(await position(), 0, 'vertical scrolling must not classify');
    await touchStart(); await touchMove(-45);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector('.vocab-flip').classList.contains('swipe-dragging'));
    assert.equal(await position(), 0, 'cancelled gestures do not classify');
    await touchStart(); await touchMove(60); await touchMove(115);
    assert.equal(await stage.getAttribute('data-swipe'), 'known');
    await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-known.png' });
    await touchEnd(); assert.equal(await position(), 1);
    assert.equal((await state()).summary.flash[`${deck.cards[0].id}_definition`].known, true);
    await view.getByRole('button', { name: '撤銷上一張分類', exact: true }).click(); await idle();
    assert.equal(await position(), 0); assert.equal((await state()).summary.flash[`${deck.cards[0].id}_definition`], undefined);
    await touchStart(); await touchMove(-60); await touchMove(-115);
    assert.equal(await stage.getAttribute('data-swipe'), 'learning');
    await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-learning.png' });
    await touchEnd(); assert.equal(await position(), 1);
    assert.equal((await state()).summary.flash[`${deck.cards[0].id}_definition`].known, false);
    await touchStart(); await touchMove(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchStart(); await touchMove(120); await touchEnd();
    assert.equal(await position(), 2, 'a second gesture during the exit cannot classify twice');
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-dark.png' });
    await page.evaluate(() => document.documentElement.classList.remove('dark-mode'));
    await view.locator('.vocab-flash-controls').getByLabel('追蹤進度', { exact: true }).uncheck(); await idle();
    assert.equal(await view.locator('.vocab-mobile-count').count(), 0);
    assert.equal(await view.locator('.vocab-flash-navigation').isVisible(), false);
    await swipe(-120); assert.equal(await position(), 3);
    await swipe(120); assert.equal(await position(), 2);
    for (let i = 0; i < 2; i++) await swipe(120);
    await swipe(120); assert.equal(await position(), 0, 'first-card boundary snaps back');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await view.locator('.vocab-flash-controls').getByLabel('追蹤進度', { exact: true }).check(); await idle();
    await swipe(-120); assert.equal(await position(), 1, 'reduced motion preserves touch classification');
    assert.equal(await stage.evaluate(element => element.getAnimations().length), 0);
    for (let i = 0; i < 3; i++) await swipe(120);
    await view.getByRole('heading', { name: '本輪字卡完成', exact: true }).waitFor();
    await view.getByRole('button', { name: '撤銷上一張分類', exact: true }).click(); await idle();
    assert.equal(await position(), 3); assert.equal((await state()).sessions.flash.completed, false);
    assert.deepEqual(errors, []);
    console.log('Mobile swipe passed: header placement, finger tracking, snap-back, tap/scroll/cancel, both ratings, undo, rapid gestures, navigation, boundaries, dark mode and reduced motion; desktop layout preserved.');
} catch (error) { await page.screenshot({ path: 'artifacts/qa/flashcard-swipe-failure.png' }); throw error; }
finally { await browser.close(); }
