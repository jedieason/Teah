import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenMistakes, filterMistakes, canonicalQuestion, applyAttempt, preparePractice } from '../src/features/mistakes/model.js';
import { validateQuiz } from '../src/shared/content.js';

test('legacy nested paths remain addressable without changing Firebase keys', () => {
    const rows = flattenMistakes({ '藥理｜B10': { abc: { def: { question: 'Q', count: 3 } } } });
    assert.equal(rows[0].recordPath, 'abc/def');
    assert.equal(rows[0].subject, '藥理');
    assert.equal(rows[0].title, 'B10');
});
test('two consecutive correct attempts master a question; later error reopens it', () => {
    const snapshot = { question: 'Q', answer: 'A' };
    let m = applyAttempt(null, snapshot, { correct: false, now: 1, eventId: '1' });
    m = applyAttempt(m, snapshot, { correct: true, now: 2, eventId: '2' });
    assert.equal(m.status, 'active');
    m = applyAttempt(m, snapshot, { correct: true, now: 3, eventId: '3' });
    assert.equal(m.status, 'mastered'); assert.equal(m.count, 1);
    m = applyAttempt(m, snapshot, { correct: false, now: 4, eventId: '4' });
    assert.equal(m.status, 'active'); assert.equal(m.correctStreak, 0); assert.equal(m.count, 2);
    assert.equal(m.firstMistake, 1);
});
test('retried events cannot double-count mistakes', () => {
    const event = { correct: false, now: 10, eventId: 'same-event' };
    const m = applyAttempt(null, { question: 'Q' }, event);
    assert.deepEqual(applyAttempt(m, { question: 'Q' }, event), m);
});
test('shuffle mapping restores original options, multiple answers, selection and explanation', () => {
    const q = canonicalQuestion({ question: 'Q', options: { A: 'second', B: 'first', C: 'third' },
        answer: ['A', 'C'], userSelection: ['B'], reverseLabelMapping: { A: 'B', B: 'A', C: 'C' }, explanation: '(A) yes (B) no' });
    assert.deepEqual(q.options, { B: 'second', A: 'first', C: 'third' });
    assert.deepEqual(q.answer, ['B', 'C']); assert.deepEqual(q.lastSelection, ['A']);
    assert.equal(q.explanation, '(B) yes (A) no');
});
test('fill-in and single element legacy arrays are normalized for practice', () => {
    const single = preparePractice({ question: 'Q', options: { A: '1', B: '2' }, answer: ['A'], quizKey: 'unit', recordPath: 'key' });
    assert.equal(single.answer, 'A'); assert.equal(single.isMultiSelect, false);
    const fill = preparePractice({ question: 'Q', answer: ['BCR', 'ABL'], quizKey: 'unit', recordPath: 'key' });
    assert.equal(fill.isFillBlank, true); assert.deepEqual(fill.answer, ['BCR', 'ABL']);
    assert.equal(fill.sourcePath, 'unit'); assert.equal(fill.mistakeRecordPath, 'key');
});
test('filters combine words, bank, subject and status without mutating the input', () => {
    const rows = flattenMistakes({ '檢驗｜B10': { a: { question: 'PCR Ct value', count: 2, lastMistake: 10 }, b: { question: 'PCR', status: 'mastered', count: 4, lastMistake: 20 } }, '藥理｜B09': { c: { question: 'PCR', count: 1 } } });
    assert.equal(filterMistakes(rows, { query: 'PCR Ct', subject: '檢驗' }).length, 1);
    assert.equal(filterMistakes(rows, { status: 'mastered' })[0].recordPath, 'b');
    assert.equal(filterMistakes(rows, { status: 'all', sort: 'frequent' })[0].recordPath, 'b');
    assert.equal(rows[0].recordPath, 'a');
});
test('malformed banks are rejected before upload', () => {
    assert.throws(() => validateQuiz([]));
    assert.throws(() => validateQuiz([{ question: 'Q', options: { A: '1', B: '2' }, answer: 'C' }]));
    assert.throws(() => validateQuiz([{ question: 'Q', answer: [] }]));
    assert.equal(validateQuiz([{ question: 'Q', answer: ['BCR'] }]).length, 1);
});
