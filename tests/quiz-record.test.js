import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuizTitle, sanitizeFilename, buildQuizRecord } from '../src/shared/quiz-record.js';

test('resolveQuizTitle correctly extracts bank name, handles archives, custom sessions and mistake practice', () => {
    assert.equal(resolveQuizTitle({ selectedJson: '檢驗醫學區段一｜B04 考古.json' }), '檢驗醫學區段一｜B04 考古');
    assert.equal(resolveQuizTitle({ selectedJson: '_Archive_藥理區段一｜B03 考古.json' }), '藥理區段一｜B03 考古');
    assert.equal(resolveQuizTitle({ selectedJson: 'QuestionBank/臨床醫學區段一｜B08 考古.json' }), '臨床醫學區段一｜B08 考古');
    assert.equal(resolveQuizTitle({ isMistakePracticeMode: true }), '錯題複習');
    assert.equal(resolveQuizTitle({ sessionKind: 'custom' }), '自訂測驗');
    assert.equal(resolveQuizTitle({ selectedJson: '' }), '測驗');
});

test('sanitizeFilename removes illegal filesystem characters while preserving full-width punctuation', () => {
    assert.equal(sanitizeFilename('檢驗醫學區段一｜B04 考古'), '檢驗醫學區段一｜B04 考古');
    assert.equal(sanitizeFilename('A/B\\C:D*E?F"G<H>I|J'), 'A_B_C_D_E_F_G_H_I_J');
    assert.equal(sanitizeFilename(''), '答題紀錄');
});

test('buildQuizRecord generates complete answer record with correct, wrong and unanswered items', () => {
    const rawQuestions = [
        {
            question: '下列何者屬於血清特異性抗體？',
            options: { A: '選項甲', B: '選項乙', C: '選項丙', D: '選項丁' },
            answer: 'A',
            explanation: '選項甲為血清特異性抗體。',
            origin: 'B04 第一次區段考 第 1 題',
            isAnswered: true,
            isCorrect: true,
            userSelection: 'A'
        },
        {
            // Shuffled options: user picked 'A' (which mapped to original 'C')
            question: '下列敘述何者錯誤？',
            options: { A: '選項丙', B: '選項丁', C: '選項甲', D: '選項乙' },
            answer: 'D', // In shuffled state, answer is D (original B)
            reverseLabelMapping: { A: 'C', B: 'D', C: 'A', D: 'B' },
            explanation: '選項乙 (B) 錯誤。',
            origin: 'B04 第一次區段考 第 2 題',
            isAnswered: true,
            isCorrect: false,
            userSelection: 'A'
        },
        {
            // Multi-select question
            question: '請選出正確的項目（複選）。',
            options: { A: '項目一', B: '項目二', C: '項目三' },
            answer: ['A', 'B'],
            explanation: '項目一與二正確。',
            isAnswered: true,
            isCorrect: false,
            userSelection: ['A', 'C']
        },
        {
            // Fill in the blank
            question: 'Ct 差距 5 循環代表 DNA 濃度差距幾倍？',
            answer: ['32:1'],
            explanation: '2^5 = 32。',
            isAnswered: true,
            isCorrect: true,
            userSelection: '32:1'
        },
        {
            // Unanswered question
            question: '未作答題目',
            options: { A: 'A選項', B: 'B選項' },
            answer: 'B',
            isAnswered: false,
            isCorrect: null,
            userSelection: null
        }
    ];

    const record = buildQuizRecord(rawQuestions, {
        selectedJson: '檢驗醫學區段一｜B04 考古.json',
        completedAt: '2026-10-26T22:00:00.000Z'
    });

    assert.equal(record.title, '檢驗醫學區段一｜B04 考古');
    assert.equal(record.completedAt, '2026-10-26T22:00:00.000Z');
    assert.deepEqual(record.summary, {
        totalQuestions: 5,
        answeredCount: 4,
        unansweredCount: 1,
        correctCount: 2,
        wrongCount: 2,
        accuracy: '50%'
    });

    // Check Question 1 (Correct single choice)
    const q1 = record.questions[0];
    assert.equal(q1.index, 1);
    assert.equal(q1.isCorrect, true);
    assert.equal(q1.result, '答對');
    assert.equal(q1.userAnswer, 'A');
    assert.equal(q1.correctAnswer, 'A');
    assert.equal(q1.userAnswerText, '選項甲');
    assert.equal(q1.correctAnswerText, '選項甲');
    assert.equal(q1.explanation, '選項甲為血清特異性抗體。');
    assert.equal(q1.origin, 'B04 第一次區段考 第 1 題');

    // Check Question 2 (Wrong single choice with shuffled mapping)
    const q2 = record.questions[1];
    assert.equal(q2.index, 2);
    assert.equal(q2.isCorrect, false);
    assert.equal(q2.result, '答錯');
    // Original options restored
    assert.deepEqual(Object.keys(q2.options), ['A', 'B', 'C', 'D']);
    assert.equal(q2.options.A, '選項甲');
    assert.equal(q2.options.B, '選項乙');
    assert.equal(q2.options.C, '選項丙');
    assert.equal(q2.options.D, '選項丁');
    // User picked shuffled 'A' which corresponds to original 'C'
    assert.equal(q2.userAnswer, 'C');
    assert.equal(q2.userAnswerText, '選項丙');
    // Correct answer was shuffled 'D' which corresponds to original 'B'
    assert.equal(q2.correctAnswer, 'B');
    assert.equal(q2.correctAnswerText, '選項乙');

    // Check Question 3 (Multi-select wrong)
    const q3 = record.questions[2];
    assert.equal(q3.index, 3);
    assert.equal(q3.isCorrect, false);
    assert.equal(q3.result, '答錯');
    assert.deepEqual(q3.userAnswer, ['A', 'C']);
    assert.deepEqual(q3.userAnswerText, ['項目一', '項目三']);
    assert.deepEqual(q3.correctAnswer, ['A', 'B']);
    assert.deepEqual(q3.correctAnswerText, ['項目一', '項目二']);

    // Check Question 4 (Fill in the blank correct)
    const q4 = record.questions[3];
    assert.equal(q4.index, 4);
    assert.equal(q4.isCorrect, true);
    assert.equal(q4.result, '答對');
    assert.equal(q4.options, null);
    assert.equal(q4.userAnswer, '32:1');
    assert.equal(q4.userAnswerText, null);
    assert.deepEqual(q4.correctAnswer, ['32:1']);

    // Check Question 5 (Unanswered)
    const q5 = record.questions[4];
    assert.equal(q5.index, 5);
    assert.equal(q5.isCorrect, false);
    assert.equal(q5.result, '未作答');
    assert.equal(q5.userAnswer, null);
    assert.equal(q5.userAnswerText, null);
    assert.equal(q5.correctAnswer, 'B');
    assert.equal(q5.correctAnswerText, 'B選項');

    // Verify it serializes to valid JSON string without error
    const jsonStr = JSON.stringify(record, null, 2);
    assert.ok(jsonStr.length > 0);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.title, '檢驗醫學區段一｜B04 考古');
    assert.equal(parsed.questions.length, 5);
});
