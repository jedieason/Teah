import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnswer, validateCard, parseCards, reviewCard, cardRequest } from '../src/features/flashcards/model.js';
const card = { front: 'What is the ratio?', back: '32:1', typingPrompt: 'The ratio is ___.', acceptedAnswers: ['32:1', '32 to 1'], explanation: 'Five doubling cycles.', sourceIds: ['s1'] };
test('typing accepts explicit synonyms, case/full-width variants but preserves medically meaningful signs and terms', () => {
    assert.ok(matchesAnswer('  ＡＤＨ  ', ['ADH'])); assert.ok(matchesAnswer('32 to 1', card.acceptedAnswers));
    assert.equal(matchesAnswer('32', card.acceptedAnswers), false); assert.equal(matchesAnswer('-32:1', card.acceptedAnswers), false);
    assert.equal(matchesAnswer('not ADH', ['ADH']), false); assert.equal(matchesAnswer('', ['']), false);
});
test('generated cards require valid source links, a single blank and bounded answers', () => {
    assert.equal(parseCards(JSON.stringify({ cards: [card] }), [{ id: 's1' }]).length, 1);
    assert.throws(() => parseCards(JSON.stringify({ cards: [{ ...card, sourceIds: ['invented'] }] }), [{ id: 's1' }]));
    assert.throws(() => parseCards(JSON.stringify({ cards: [card, card] }), [{ id: 's1' }]));
    for (const change of [{ typingPrompt: 'no blank' }, { typingPrompt: '___ and ___' }, { acceptedAnswers: [] }, { acceptedAnswers: [''] }, { back: '' }]) assert.throws(() => validateCard({ ...card, ...change }));
    assert.equal(cardRequest([{ id: 's1' }]).generationConfig.responseMimeType, 'application/json');
});
test('reviewing cards updates their own schedule without mutating question progress', () => {
    const result = reviewCard(card, true, 100);
    assert.equal(result.dueAt, 86400100); assert.equal(result.reviewCount, 1); assert.equal(card.reviewCount, undefined);
    assert.equal(reviewCard({ ...result, intervalDays: 90 }, true).intervalDays, 90);
    assert.equal(reviewCard(result, false).intervalDays, 1);
});
