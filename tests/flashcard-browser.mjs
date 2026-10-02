import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, reducedMotion: 'reduce' });
const fixture = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
const db = { quizCatalog: { Demo: { count: 1 } }, Demo: [{ question: 'Existing', options: { A: 'One', B: 'Two' }, answer: 'B' }], learning: { 'test-user': { legacy: { title: 'Old cards' } } }, mistakes: { 'test-user': {} } };
await context.addInitScript(data => { window.__testDatabase = JSON.parse(sessionStorage.getItem('vocab-db') || JSON.stringify(data)); }, db);
await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route(/firebasedatabase|firebaseio|googleapis.com\/identity|gstatic.com\/firebasejs/, route => route.abort());
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(25000);
page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
const view = page.locator('#flashcardPage'), dialog = page.getByRole('dialog', { name: '匯入文字', exact: true });
const words = [['apple', '蘋果'], ['banana', '香蕉'], ['cherry', '櫻桃'], ['grape', '葡萄'], ['pear', '梨'], ['orange', '橘子'], ['lemon', '檸檬'], ['peach', '桃子'], ['melon', '甜瓜']];
await mkdir('artifacts/qa', { recursive: true });
try {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' }); console.log('Loaded page');
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    await view.getByText('尚無字卡集', { exact: true }).waitFor(); console.log('Opened vocabulary');
    assert.equal(await page.locator('.home-content').isVisible(), false);
    await view.getByRole('button', { name: '＋ 建立字卡集', exact: true }).click();
    await view.getByLabel('字卡集名稱', { exact: true }).fill('水果單字');
    await view.getByRole('button', { name: '匯入文字', exact: true }).click();
    await dialog.getByLabel('貼上文字', { exact: true }).fill(words.map(w => w.join('::')).join('||'));
    await dialog.getByLabel('單字與解釋之間', { exact: true }).selectOption('custom');
    await dialog.getByLabel('自訂單字分隔符', { exact: true }).fill('::');
    await dialog.getByLabel('字卡與字卡之間', { exact: true }).selectOption('custom');
    await dialog.getByLabel('自訂字卡分隔符', { exact: true }).fill('||');
    assert.equal(await dialog.locator('.vocab-import-preview > div').count(), 9);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-import.png', fullPage: true });
    await dialog.getByRole('button', { name: '匯入', exact: true }).click();
    await view.getByLabel('單字 1', { exact: true }).fill('**apple**');
    await view.getByRole('button', { name: '第 1 張下移', exact: true }).click();
    assert.equal(await view.getByLabel('單字 2', { exact: true }).inputValue(), '**apple**');
    await view.getByRole('button', { name: '第 2 張上移', exact: true }).click();
    await view.getByRole('button', { name: '完成', exact: true }).click();
    await view.getByRole('heading', { name: '水果單字', exact: true }).waitFor();
    await page.waitForFunction(() => Object.keys(window.__testDatabase.flashcard?.['test-user']?.sets || {}).length === 1);
    let stored = await page.evaluate(() => Object.values(window.__testDatabase.flashcard['test-user'].sets)[0]);
    const deckId = stored.id; assert.equal(stored.cards.length, 9);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-set.png', fullPage: true });
    await view.getByRole('button', { name: 'Flashcards', exact: true }).click();
    await view.getByRole('button', { name: '查看背面', exact: true }).waitFor();
    await view.getByLabel('追蹤進度', { exact: true }).check();
    await view.locator('[aria-busy="true"]').waitFor({state:'hidden'}); await page.waitForFunction(() => document.getElementById('flashcardPage').getAttribute('aria-busy') !== 'true'); await page.keyboard.press('Space'); await view.locator('.vocab-flip.flipped').waitFor();
    await page.screenshot({ path: 'artifacts/qa/vocabulary-flip.png', fullPage: true });
    await page.keyboard.press('ArrowLeft'); await view.getByText('還在學習 1', { exact: true }).waitFor();
    await view.getByRole('button', { name: '知道了 →', exact: true }).click();
    await view.getByText('知道了 1', { exact: true }).waitFor();
    await view.getByRole('button', { name: '‹ 水果單字', exact: true }).click();
    await view.getByRole('button', { name: 'Learn', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Learn 設定', exact: true });
    await settings.getByLabel('作答方向', { exact: true }).selectOption('term');
    await settings.getByLabel('複選題', { exact: true }).uncheck();
    await settings.getByLabel('答錯後重打正解', { exact: true }).check();
    await settings.getByRole('button', { name: '開始 Learn', exact: true }).click();
    await view.locator('.vocab-choices').waitFor();
    await view.getByRole('button', { name: '不知道', exact: true }).click();
    await view.getByText('再練一次', { exact: true }).waitFor();
    assert.equal(await view.locator('.correct-option').count(), 1);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-learn-wrong.png', fullPage: true });
    await view.getByRole('button', { name: '繼續', exact: true }).click({force:true});
    await page.waitForFunction(() => Object.values(window.__testDatabase.flashcard['test-user'].study)[0].sessions.learn.ordinal === 1);
    await page.evaluate(() => sessionStorage.setItem('vocab-db', JSON.stringify(window.__testDatabase)));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Flashcard', exact: true }).click();
    await view.getByRole('button', { name: '水果單字', exact: true }).click();
    await view.getByRole('button', { name: '繼續 Learn', exact: true }).click();
    const state = async () => {
        await page.waitForFunction(deckId => {
            const v = document.getElementById('flashcardPage'), s = window.__testDatabase.flashcard['test-user'].study[deckId]?.sessions.learn;
            return v.getAttribute('aria-busy') !== 'true' && s?.ordinal === Number(v.dataset.ordinal) && (s.feedback ? s.feedback.correct ? 'correct' : 'wrong' : 'none') === v.dataset.feedback && (s.current?.key || '') === v.dataset.currentKey;
        }, deckId);
        return page.evaluate(deckId => window.__testDatabase.flashcard['test-user'].study[deckId]?.sessions.learn, deckId);
    };
    let s = await state(); assert.equal(s.ordinal, 1); const seen = new Set(); let checkpoint = false, repaired = false, override = false;
    for (let guard = 0; guard < 70; guard++) {
        await view.waitFor({ state: 'visible' }); s = await state();
        if (s.completed) break;
        if (s.checkpoint) {
            checkpoint = true; await page.screenshot({ path: 'artifacts/qa/vocabulary-learn-round.png', fullPage: true });
            await page.keyboard.press('Space'); continue;
        }
        assert.ok(s?.current); const card = stored.cards.find(c => c.id === s.current.cardId); seen.add(card.id);
        const expected = (s.current.direction === 'term' ? card.term : card.definition).replace(/\*\*/g, '');
        if (s.feedback) { await view.getByRole('button', { name: '繼續', exact: true }).click({force:true}); continue; }
        if (s.facts[s.current.key].wrong && s.facts[s.current.key].streak > 0) assert.equal(await view.locator('.vocab-retry-label').count(), 0);
        if (s.current.type === 'written') {
            const input = view.getByLabel('你的答案', { exact: true });
            if (!repaired) {
                await input.fill('未完成的答案');
                await view.getByRole('button', { name: '標記星號', exact: true }).click(); await state();
                assert.equal(await input.inputValue(), '未完成的答案');
                await view.getByRole('button', { name: '顯示提示', exact: true }).click(); await state();
                assert.ok((await view.locator('.vocab-written-hint').innerText()).includes('_'));
                assert.equal(await input.inputValue(), '未完成的答案');
                await page.screenshot({ path: 'artifacts/qa/vocabulary-hint.png', fullPage: true });
                await input.fill('錯誤答案'); await input.press('Enter');
                await view.getByLabel('重打正確答案', { exact: true }).waitFor();
                const correction = view.getByLabel('重打正確答案', { exact: true }); await correction.fill(expected); await correction.press('Enter');
                repaired = true; continue;
            }
            if (!override) {
                await input.fill('別的答案'); await input.press('Enter');
                await view.getByRole('button', { name: '我的答案其實正確', exact: true }).click();
                override = true;
            } else { await input.fill(expected); await input.press('Enter'); }
        } else {
            const index = s.current.choices.findIndex(c => c.replace(/\*\*/g, '') === expected);
            assert.ok(index >= 0); await view.locator('.vocab-choice').nth(index).click();
        }
        await view.getByText('✓ 答對了', { exact: true }).waitFor();
        if (guard === 5) await page.screenshot({ path: 'artifacts/qa/vocabulary-learn-correct.png', fullPage: true });
        if (!await view.getByRole('button', { name: '繼續', exact: true }).isVisible()) continue;
        await view.getByRole('button', { name: '繼續', exact: true }).click({force:true});
    }
    await view.getByRole('heading', { name: '本次學習完成', exact: true }).waitFor();
    assert.ok(checkpoint && repaired && override); assert.equal(seen.size, 9);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-learn-complete.png', fullPage: true });
    await view.getByRole('button', { name: '繼續練習', exact: true }).click();
    await view.getByRole('heading', { name: '持續練習', exact: true }).waitFor(); s = await state();
    assert.equal(s.options.practice, true); assert.equal(s.completed, false); assert.equal(await view.locator('.vocab-learn-progress').count(), 0);
    const practicingCard = stored.cards.find(c => c.id === s.current.cardId);
    await view.getByLabel('你的答案', { exact: true }).fill(practicingCard.term.replace(/\*\*/g, ''));
    await view.getByRole('button', { name: '確認答案', exact: true }).click(); await view.getByText('✓ 答對了', { exact: true }).waitFor();
    await view.getByRole('button', { name: '繼續', exact: true }).click({force:true}); s = await state(); assert.equal(s.ordinal, 1); assert.equal(s.completed, false);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-practice.png', fullPage: true });
    await view.getByRole('button', { name: '‹ 水果單字', exact: true }).click();
    await view.getByRole('button', { name: 'Learn', exact: true }).click();
    await page.getByRole('dialog', { name: 'Learn 設定', exact: true }).getByRole('button', { name: '開始 Learn', exact: true }).click();
    await view.getByRole('heading', { name: '本次學習完成', exact: true }).waitFor();
    await view.getByRole('button', { name: '重新開始 Learn', exact: true }).click(); s = await state();
    assert.equal(s.options.practice, false); assert.equal(s.generation === 'initial', false); assert.equal(s.ordinal, 0); assert.equal(Object.values(s.facts).some(f => f.credit !== 0), false);
    await view.getByRole('button', { name: '‹ 水果單字', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__testDatabase.learning['test-user'].legacy.title), 'Old cards');
    await view.getByRole('button', { name: '編輯字卡集', exact: true }).click();
    await view.getByLabel('解釋 1', { exact: true }).fill('紅色或綠色的水果');
    await view.getByRole('button', { name: '完成', exact: true }).click();
    await page.waitForFunction(deckId => window.__testDatabase.flashcard['test-user'].sets[deckId].revision === 2, deckId);
    stored = await page.evaluate(deckId => window.__testDatabase.flashcard['test-user'].sets[deckId], deckId);
    assert.equal(stored.cards[0].revision, 2); assert.equal(stored.cards[1].revision, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await view.evaluate(e => e.scrollWidth > e.clientWidth), false);
    await page.screenshot({ path: 'artifacts/qa/vocabulary-mobile.png', fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark-mode'));
    await page.screenshot({ path: 'artifacts/qa/vocabulary-dark-mobile.png', fullPage: true });
    await view.getByRole('button', { name: '刪除字卡集', exact: true }).click();
    await view.getByRole('button', { name: '已刪除', exact: true }).click();
    await view.getByRole('button', { name: '復原字卡集', exact: true }).click();
    await view.getByRole('button', { name: '返回字卡集', exact: true }).click();
    await view.getByRole('button', { name: '水果單字', exact: true }).click();
    await page.evaluate(() => { window.__failWrites = true; });
    await view.getByRole('button', { name: '編輯字卡集', exact: true }).click();
    await view.getByLabel('字卡集名稱', { exact: true }).fill('離線水果單字');
    await view.getByRole('button', { name: '完成', exact: true }).click();
    await view.getByRole('heading', { name: '離線水果單字', exact: true }).waitFor();
    await page.evaluate(() => { window.__failWrites = false; window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(deckId => window.__testDatabase.flashcard['test-user'].sets[deckId].title === '離線水果單字', deckId);
    assert.deepEqual(errors, []);
    console.log('Vocabulary passed: custom bulk import, reorder/edit, flip/sorting, Learn spaced retries/checkpoints/typing/repair/override, reload resume, revision reset, mobile/dark, trash recovery, offline replay and legacy isolation.');
} catch (error) { await page.screenshot({ path: 'artifacts/qa/vocabulary-failure.png', fullPage: true }); console.log(await view.innerText()); throw error; } finally { await browser.close(); }
