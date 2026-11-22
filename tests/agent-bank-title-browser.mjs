import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const key = '舊科目｜舊名稱';
const storageKey = 'existing-progress-key';
const title = '新科目｜新名稱';
const questions = [
    { question: '第一道原始題幹', questionId: 'q_first', answer: '甲' },
    { question: '第二道原始題幹', questionId: 'q_second', answer: '乙' }
];
const data = {
    [key]: questions, quizCatalog: { [key]: { count: 2, storageKey, title } },
    progress: { 'test-user': { quizzes: { [storageKey]: { selectedJson: key, currentIndex: 1, lastUpdated: 500, allQuestions: [
        { ...questions[0], isFillBlank: true, isAnswered: true, isConfirmed: true, isCorrect: true, userSelection: '甲' },
        { ...questions[1], isFillBlank: true }
    ] } } } }
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const firebase = await readFile(new URL('./fixtures/firebase.js', import.meta.url), 'utf8');
    await context.addInitScript(value => { window.__testDatabase = value; }, data);
    await context.route('**/src/services/firebase.js', route => route.fulfill({ contentType: 'text/javascript', body: firebase }));
    await context.route(/firebasedatabase|firebaseio|gstatic.com\/firebasejs/, route => route.abort());

    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^新科目 1 份題庫/ }).click();
    const bank = page.locator('.bank-card');
    assert.equal(await bank.getAttribute('data-json'), key);
    await bank.getByRole('button', { name: /^新名稱 2 題 已作答 1\/2/ }).click();
    await page.getByRole('button', { name: '繼續測驗', exact: true }).click();
    await page.getByText(questions[1].question, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.quiz-title').innerText(), title);
    await page.getByRole('button', { name: '返回題庫', exact: true }).click();
    await page.locator('#bankSearch').fill('第二道原始題幹');
    const result = page.locator('.question-search-card');
    await result.getByText('新科目 · 新名稱 · 第 2 題', { exact: true }).waitFor({ state: 'visible' });
    console.log('Renamed bank displays its new title in the library, resumed quiz and search while keeping its original progress key.');
} finally { await browser.close(); }
