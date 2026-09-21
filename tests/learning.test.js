import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLearningEvent, selectQuestions, normalizeQuestion, DAY, summarize } from '../src/features/learning/model.js';
const event = (id, when, correct = true) => ({ eventId: id, questionId: 'q1', submittedAt: when, isCorrect: correct, sourcePath: 'bank', responseTimeMs: 10000 });
test('out of order reconnect and duplicate delivery produce identical review schedules', () => {
    const first = event('a', DAY), second = event('b', DAY * 2), third = event('c', DAY * 3, false);
    const ordered = [first, second, third].reduce(applyLearningEvent, {});
    const replayed = [third, first, second, third, first].reduce(applyLearningEvent, {});
    assert.deepEqual(replayed.reviews, ordered.reviews); assert.equal(Object.keys(replayed.attempts).length, 3);
    assert.equal(replayed.reviews.q1.dueAt, DAY * 4); assert.equal(replayed.reviews.q1.streak, 0);
});
test('question identity and taxonomy survive wording changes and reordered import', () => {
    const q = normalizeQuestion({ question: 'old', questionId: 'q1', revision: 2, taxonomy: { topic: 'topic' } }, 'bank', 0);
    const updated = normalizeQuestion({ ...q, question: 'new' }, 'renamed', 20);
    assert.equal(updated.questionId, 'q1'); assert.equal(updated.revision, 2); assert.equal(updated.taxonomy.topic, 'topic');
});
test('builder combines metadata, status and limits without mutating banks', () => {
    const items = ['q1', 'q2', 'q3'].map(questionId => ({ questionId, taxonomy: { subject: '心臟', year: 2025 } }));
    const state = applyLearningEvent({}, event('a', 0, false));
    assert.deepEqual(selectQuestions(items, { subject: '心臟', year: '2025', status: 'due' }, state, DAY).map(q => q.questionId), ['q1']);
    assert.equal(selectQuestions(items, { status: 'new', count: 1 }, state).length, 1);
    assert.equal(selectQuestions(items, { topic: 'unknown' }, state).length, 0);
    assert.equal(items.length, 3);
});
test('statistics count events, handle empty and apply the requested time window', () => {
    assert.equal(summarize({}).accuracy, null);
    assert.deepEqual(summarize({ a: event('a', 1), b: event('b', 3, false) }, 2), { count: 1, accuracy: 0, seconds: 10 });
});
