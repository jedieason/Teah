import test from 'node:test';
import assert from 'node:assert/strict';
import { editingBatches, editingRequest, parseEditedBatch } from '../src/features/flashcard/editing.js';
const cards = [{ id: 'a', term: 'teh', definition: 'the', termAliases: [], definitionAliases: [], revision: 1 }, { id: 'b', term: 'same', definition: 'same', termAliases: [], definitionAliases: [], revision: 1 }];
const draft = { title: '拼字', description: '', termLanguage: 'en-US', definitionLanguage: 'en-US', cards };
const edited = { ...draft, definitionLanguage: 'zh-TW', cards: [{ ...cards[1], definition: '**相同**' }, { ...cards[0], term: 'the', definition: '定冠詞' }] };
test('AI editing carries current cards and instructions without permitting new cards', () => {
    const request = editingRequest(draft, cards, '修正拼字並翻譯為繁體中文');
    const input = JSON.parse(request.contents[0].parts[0].text);
    assert.deepEqual(input.cards, cards); assert.equal(input.instructions, '修正拼字並翻譯為繁體中文');
    assert.throws(() => editingRequest(draft, cards, '  '));
    assert.throws(() => editingRequest(draft, cards, 'x'.repeat(4001)));
    assert.throws(() => editingBatches({ ...draft, title: '' }));
    assert.throws(() => editingBatches({ ...draft, cards: [] }));
    assert.throws(() => editingBatches({ ...draft, cards: [{ ...cards[0], definition: '' }] }));
});
test('editing preserves identities and order, supports formatting/language, and leaves originals intact', () => {
    const result = parseEditedBatch(JSON.stringify(edited), cards);
    assert.deepEqual(result.cards.map(c => c.id), ['a', 'b']);
    assert.equal(result.cards[0].term, 'the'); assert.equal(result.cards[1].definition, '**相同**');
    assert.equal(result.definitionLanguage, 'zh-TW'); assert.equal(result.cards[0].revision, 1);
    assert.equal(cards[0].term, 'teh');
    assert.doesNotThrow(() => parseEditedBatch(JSON.stringify({ ...edited, cards: edited.cards.map(c => ({ ...c, term: 'same' })) }), cards), 'existing duplicate terms must not discard cards');
});
test('editing rejects dropped/added/duplicate/foreign identities, malformed sides and inconsistent batch metadata', () => {
    for (const changes of [{ cards: [] }, { cards: [...edited.cards, edited.cards[0]] }, { cards: [edited.cards[0], edited.cards[0]] }, { cards: [{ ...edited.cards[0], id: 'unknown' }, edited.cards[1]] },
        { cards: [{ ...edited.cards[0], term: '' }, edited.cards[1]] }, { cards: [{ ...edited.cards[0], definitionAliases: [''] }, edited.cards[1]] }, { definitionLanguage: '' }]) assert.throws(() => parseEditedBatch(JSON.stringify({ ...edited, ...changes }), cards));
    assert.throws(() => parseEditedBatch(JSON.stringify(edited), cards, { title: draft.title, description: '', termLanguage: 'en-US', definitionLanguage: 'en-US' }));
});
test('editing batches preserve all cards and bound both card count and text size', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ ...cards[0], id: `c${i}` }));
    const batches = editingBatches({ ...draft, cards: many });
    assert.ok(batches.every(b => b.length <= 30)); assert.deepEqual(batches.flat(), many);
    const long = cards.map(c => ({ ...c, term: 'a'.repeat(4000), definition: 'b'.repeat(4000) }));
    assert.equal(editingBatches({ ...draft, cards: [...long, ...long] }).length, 2);
});
