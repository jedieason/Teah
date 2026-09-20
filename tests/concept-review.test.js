import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewQuestions, reviewRequest, parseReview } from '../src/features/concept-review/model.js';

test('review captures only wrong answers and restores shuffled labels without changing the quiz', () => {
    const question = { question: 'test', isAnswered: true, isCorrect: false, options: { A: 'two', B: 'one' }, answer: ['B'], userSelection: ['A'], reverseLabelMapping: { A: 'B', B: 'A' } };
    const result = reviewQuestions([{ ...question, isCorrect: true }, question, { ...question, isAnswered: false }, { question: 'fill', isAnswered: true, isCorrect: false, answer: ['32'], userSelection: '16' }], 'bank');
    assert.equal(result.length, 2);
    assert.equal(result[0].questionId, 'q2');
    assert.deepEqual(result[0].answer, ['A']);
    assert.deepEqual(result[0].lastSelection, ['B']);
    assert.equal(result[1].lastSelection, '16');
    assert.deepEqual(question.userSelection, ['A']);
});

test('one overview groups multiple wrong answers and validates complete coverage', () => {
    const input = Array.from({ length: 12 }, (_, i) => ({ questionId: `q${i + 1}` }));
    const area = { unit: 'u', title: 't', blindSpot: 'b', studyFocus: 'f', questionIds: input.map(q => q.questionId) };
    const valid = { summary: 'overview', studyAreas: [area], remember: [{ concept: 'c', rule: 'r', distinction: 'd' }], uncertainty: '' };
    assert.equal(JSON.parse(reviewRequest(input).contents[0].parts[0].text).length, 12);
    assert.equal(parseReview(JSON.stringify(valid), input).studyAreas.length, 1);
    const invalid = [
        { ...valid, studyAreas: [] },
        { ...valid, studyAreas: [area, area] },
        { ...valid, studyAreas: [{ ...area, questionIds: ['q1'] }] },
        { ...valid, studyAreas: [{ ...area, questionIds: [...area.questionIds, 'unknown'] }] },
        { ...valid, remember: [] },
        { ...valid, remember: [{ concept: 'c', rule: {}, distinction: 'd' }] },
        { ...valid, summary: 'x'.repeat(1001) }
    ];
    for (const data of invalid) assert.throws(() => parseReview(JSON.stringify(data), input));
    assert.throws(() => parseReview('not json', input));
    assert.deepEqual(reviewQuestions([{ isAnswered: true, isCorrect: true }]), []);
});
