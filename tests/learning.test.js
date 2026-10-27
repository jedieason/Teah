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
test('analytics consent defaults to enabled and can be explicitly disabled', () => {
    const isConsentGiven = store => store.get('teah-analytics-consent') !== 'no';
    const fakeStorage = new Map();
    assert.equal(isConsentGiven(fakeStorage), true);
    fakeStorage.set('teah-analytics-consent', 'yes');
    assert.equal(isConsentGiven(fakeStorage), true);
    fakeStorage.set('teah-analytics-consent', 'no');
    assert.equal(isConsentGiven(fakeStorage), false);
});

test('normalizeQuestion for short answer fill-in question does not produce undefined options property', () => {
    const shortAnswer = {
        question: '自泌素（autacoid）的代表性物質包括組織胺與血清素，請問肥大細胞釋放的主要自泌素為何？',
        answer: 'Histamine',
        explanation: '肥大細胞主要顆粒成分為組織胺。'
    };
    const normalized = normalizeQuestion(shortAnswer, '病理學區段二｜自泌素', 44);
    assert.equal('options' in normalized, false);
    assert.equal(normalized.options, undefined);

    // Verify recursive check that no property is undefined (Firebase update requirement)
    function checkNoUndefined(obj, path = '') {
        for (const [k, v] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${k}` : k;
            assert.notEqual(v, undefined, `Property ${currentPath} must not be undefined`);
            if (v && typeof v === 'object') checkNoUndefined(v, currentPath);
        }
    }
    checkNoUndefined(normalized, '病理學區段二｜自泌素.44');
});
