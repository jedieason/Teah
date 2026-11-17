import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prepareDeck, createSession, submitAnswer, advanceSession } from '../src/features/flashcard/model.js';

const expected = '1. Variable atelectasis and dilation of alveoli with edematous, thickened alveolar septa 2. Hyaline membrane lining alveolar space: homogeneous eosinophilic linear material closely adherent to the alveolar surface 3. May hemorrhage';
const response = 'variable alectalasis with thickened septa and collapsed alveoli and surface';
const deck = prepareDeck({ title: '病理學 Micro（二）考古', termLanguage: 'en-US', definitionLanguage: 'en-US', cards: [
    { term: 'Previous question', definition: 'Previous answer' },
    { term: 'Hyaline membrane disease - Lung (neonatal)', definition: expected },
    { term: 'Neuroblastoma - Adrenal gland', definition: 'Circumscribed tumor, nests and sheets of neuroblasts, small round to oval cells with salt and pepper chromatin, indiscernible cytoplasm, neuropil with eosinophilic fibrillary material, Homer-Wright rosette, extensive hemorrhage and focal calcification' },
    ...Array.from({ length: 6 }, (_, i) => ({ term: `Question ${i}`, definition: `Answer ${i}` }))
] });
let session = createSession(deck, {}, { direction: 'definition', types: ['written'], grading: 'standard', sound: false });
session = advanceSession(submitAnswer(session, deck, 'Previous answer'), deck);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1140, height: 634 }, deviceScaleFactor: 1.5 });
await context.addInitScript(data => { window.__testDatabase = data; }, { quizCatalog: {}, flashcard: { 'test-user': { sets: { [deck.id]: deck }, study: { [deck.id]: { sessions: { learn: session } } } } } });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
// Deterministic semantic acceptance; no external model or production writes.
await context.route('**/src/features/flashcard/equivalence.js', route => route.fulfill({ contentType: 'text/javascript', body: `export async function gradeEquivalence() { await new Promise(resolve => setTimeout(resolve, 350)); return {status:'correct',correct:true,reason:'semantic-equivalent'}; }` }));
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
const view = page.locator('#flashcardPage'), panel = view.locator('.vocab-question');
const idle = () => page.waitForFunction(() => document.querySelector('#flashcardPage').getAttribute('aria-busy') !== 'true');
const settle = () => view.evaluate(e => Promise.all(e.getAnimations({ subtree: true }).filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished)));
await mkdir('artifacts/qa/quizlet', { recursive: true });
try {
    await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.locator('#tabFlashcard').click();
    await view.getByRole('button', { name: deck.title, exact: true }).click();
    await view.getByRole('button', { name: '繼續 Learn', exact: true }).click(); await idle(); await settle();
    assert.equal(await view.locator('.vocab-study-title > span').innerText(), deck.title);
    const title = await view.locator('.vocab-study-title').boundingBox();
    assert.ok(Math.abs(title.x + title.width / 2 - 570) < 1, 'the retained title stays centered');
    const input = view.getByLabel('你的答案', { exact: true });
    assert.equal(await input.evaluate(e => e.tagName), 'TEXTAREA');
    assert.equal(await input.evaluate(e => getComputedStyle(e).resize), 'vertical');
    await page.screenshot({ path: 'artifacts/qa/quizlet/answering.png' });
    await input.fill('first'); await input.press('Shift+Enter'); await input.press('s');
    assert.equal(await input.inputValue(), 'first\ns', 'short answers can also contain newlines');
    await input.evaluate(e => { e.style.height = '128px'; });
    assert.ok((await input.boundingBox()).height >= 128);
    await input.evaluate(e => { e.style.height = ''; });
    await input.fill(response);
    await view.getByRole('button', { name: '確認答案', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#flashcardPage').getAttribute('aria-busy') === 'true');
    assert.equal(await input.inputValue(), response, 'grading preserves the answer without a skeleton');
    assert.equal(await input.isDisabled(), true);
    await page.screenshot({ path: 'artifacts/qa/quizlet/grading.png' });
    await idle(); await settle();
    assert.equal(await view.locator('.vocab-response').innerText(), response);
    assert.equal(await view.locator('.vocab-expected-answer').innerText(), expected);
    assert.equal(await view.locator('.vocab-response mark,.vocab-expected-answer mark').count(), 0, 'accepted prose has no spelling highlights');
    assert.equal(await view.getByRole('button', { name: '我是錯的', exact: true }).isVisible(), true);
    assert.equal(await view.getByRole('progressbar').getAttribute('aria-valuenow'), '2');
    await page.screenshot({ path: 'artifacts/qa/quizlet/result.png' });
    await page.keyboard.press('x');
    await page.waitForFunction(() => document.querySelector('.vocab-question').getAnimations().some(a => a.playState === 'running'));
    await panel.evaluate(e => e.getAnimations().forEach(a => { a.pause(); a.currentTime = 50; }));
    assert.equal(await view.locator('.vocab-study-title > span').isVisible(), true, 'the header stays visible during the transition');
    await page.screenshot({ path: 'artifacts/qa/quizlet/transition-out.png' });
    await panel.evaluate(e => e.getAnimations().forEach(a => a.finish()));
    await view.locator('.vocab-prompt').filter({ hasText: 'Neuroblastoma' }).waitFor();
    await panel.evaluate(e => e.getAnimations().forEach(a => { a.pause(); a.currentTime = 100; }));
    await page.screenshot({ path: 'artifacts/qa/quizlet/transition-in.png' });
    await panel.evaluate(e => e.getAnimations().forEach(a => a.finish()));
    await idle(); await settle();
    assert.match(await view.locator('.vocab-prompt').innerText(), /Neuroblastoma/);
    assert.equal(await input.inputValue(), '', 'any key continues without typing into the next answer');
    await page.screenshot({ path: 'artifacts/qa/quizlet/next.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    await input.fill('mobile\nanswer');
    assert.equal(await view.getByRole('button', { name: '確認答案', exact: true }).isEnabled(), true);
    await settle();
    assert.equal(await view.evaluate(e => e.scrollWidth > e.clientWidth), false);
    await page.screenshot({ path: 'artifacts/qa/quizlet/mobile.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await view.getByRole('button', { name: '不知道', exact: true }).click(); await idle();
    assert.equal(await panel.evaluate(e => e.getAnimations({ subtree: true }).length), 0);
    await page.screenshot({ path: 'artifacts/qa/quizlet/mobile-result.png' });
    await page.setViewportSize({ width: 1140, height: 634 });
    await settle();
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    assert.equal(await view.locator('.vocab-study-header').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(16, 22, 43)');
    await page.screenshot({ path: 'artifacts/qa/quizlet/dark-result.png' });
    assert.deepEqual(errors, []);
    console.log('Quizlet written layout, preserved title, multiline/resize, grading, result, keyboard and mobile checks passed.');
} catch (error) { await page.screenshot({ path: 'artifacts/qa/quizlet/failure.png' }); throw error; }
finally { await browser.close(); }
