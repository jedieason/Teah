import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateQuestionPayload,
    formatQuestionJson,
    mergeQuestionEdit
} from '../src/features/library/content-editor.js';

test('validateQuestionPayload for unit mode', () => {
    const validUnit = [
        {
            question: '什麼是糖尿病的最常見型態？',
            options: { A: '第一型', B: '第二型', C: '妊娠型', D: '其他' },
            answer: 'B',
            explanation: '第二型糖尿病佔九成以上。'
        }
    ];

    // Passes array directly
    const res1 = validateQuestionPayload(validUnit, 'unit');
    assert.deepEqual(res1, validUnit);

    // Passes JSON string
    const res2 = validateQuestionPayload(JSON.stringify(validUnit), 'unit');
    assert.deepEqual(res2, validUnit);

    // Empty string throws
    assert.throws(() => validateQuestionPayload('', 'unit'), /內容不可為空/);
    assert.throws(() => validateQuestionPayload('   ', 'unit'), /內容不可為空/);

    // Invalid JSON throws
    assert.throws(() => validateQuestionPayload('{ broken', 'unit'), /JSON 語法錯誤/);

    // Object instead of array throws
    assert.throws(() => validateQuestionPayload(JSON.stringify(validUnit[0]), 'unit'), /整個單元內容必須為題目 JSON 陣列/);

    // Invalid question format (missing answer) throws
    const invalidQuestions = [
        {
            question: '無答案題目',
            options: { A: '甲', B: '乙' }
        }
    ];
    assert.throws(() => validateQuestionPayload(invalidQuestions, 'unit'));
});

test('validateQuestionPayload for single question mode', () => {
    const validQ = {
        question: '人體最大的實質器官是？',
        options: { A: '心臟', B: '肝臟', C: '肺臟', D: '脾臟' },
        answer: 'B',
        explanation: '肝臟是人體最大實質器官。'
    };

    // Passes single object
    const res1 = validateQuestionPayload(validQ, 'single');
    assert.deepEqual(res1, validQ);

    // Passes JSON string of object
    const res2 = validateQuestionPayload(JSON.stringify(validQ), 'single');
    assert.deepEqual(res2, validQ);

    // Passes single-element array (user pasted `[{ ... }]`)
    const res3 = validateQuestionPayload([validQ], 'single');
    assert.deepEqual(res3, validQ);

    // Multi-element array throws
    assert.throws(() => validateQuestionPayload([validQ, validQ], 'single'), /單一題目模式請輸入單一題目物件/);

    // Primitive or null throws
    assert.throws(() => validateQuestionPayload('123', 'single'), /單一題目格式不正確/);
    assert.throws(() => validateQuestionPayload('null', 'single'), /單一題目格式不正確/);

    // Invalid question format (missing question, or answer not in options) throws
    assert.throws(() => validateQuestionPayload({ question: '', answer: 'A' }, 'single'));
    assert.throws(() => validateQuestionPayload({ question: '題幹', answer: 'C', options: { A: '1', B: '2' } }, 'single'));
});

test('formatQuestionJson produces 2-space indented JSON', () => {
    const obj = { a: 1, b: ['x'] };
    const formatted = formatQuestionJson(obj);
    assert.equal(formatted, JSON.stringify(obj, null, 2));
});

test('mergeQuestionEdit preserves original questionId, taxonomy, and increments revision', () => {
    const originalList = [
        {
            questionId: 'q-orig-1',
            revision: 2,
            taxonomy: { category: '生理' },
            question: '第 1 題題幹',
            options: { A: '選項 A', B: '選項 B' },
            answer: 'A'
        },
        {
            questionId: 'q-orig-2',
            revision: 1,
            question: '第 2 題題幹',
            options: { A: '選項 A', B: '選項 B' },
            answer: 'B'
        }
    ];

    // User updated question 0 without including questionId or taxonomy
    const updatedQ0 = {
        question: '第 1 題修訂題幹',
        options: { A: '修訂選項 A', B: '修訂選項 B' },
        answer: 'A',
        explanation: '新增詳解'
    };

    const merged = mergeQuestionEdit(originalList, updatedQ0, 0);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].question, '第 1 題修訂題幹');
    assert.equal(merged[0].questionId, 'q-orig-1'); // Preserved original questionId
    assert.equal(merged[0].revision, 3); // revision incremented from 2 to 3
    assert.deepEqual(merged[0].taxonomy, { category: '生理' }); // Preserved original taxonomy
    assert.equal(merged[0].explanation, '新增詳解');

    // Untouched questions remain intact
    assert.deepEqual(merged[1], originalList[1]);

    // Out of bounds index throws
    assert.throws(() => mergeQuestionEdit(originalList, updatedQ0, -1), /序號超出範圍/);
    assert.throws(() => mergeQuestionEdit(originalList, updatedQ0, 5), /序號超出範圍/);
});
