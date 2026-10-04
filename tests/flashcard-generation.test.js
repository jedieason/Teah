import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceQuestions, generationRequest, parseGeneratedDeck } from '../src/features/flashcard/generation.js';
import { prepareDeck } from '../src/features/flashcard/model.js';
const sources = sourceQuestions([{ questionId: 'q1', question: 'Ct 相差 5？', answer: '32:1', explanation: '理想倍增為 2⁵。', origin: '檢驗學' }]);
const card = { term: 'Ct 相差 5 次，起始量比為何？', definition: '32:1', termAliases: [], definitionAliases: ['32 to 1'], sourceIds: ['s1'] };
const deck = { title: 'PCR 字卡', description: 'Ct 判讀', termLanguage: 'zh-TW', definitionLanguage: 'zh-TW', cards: [card] };
const parse = (value = deck, input = sources) => parseGeneratedDeck(JSON.stringify(value), input);
test('generation carries custom instructions separately from bounded question sources', () => {
    const request = generationRequest(sources, '只整理判讀步驟，用條列呈現');
    const input = JSON.parse(request.contents[0].parts[0].text);
    assert.equal(input.instructions, '只整理判讀步驟，用條列呈現');
    assert.deepEqual(input.sources, sources);
    assert.equal(input.sources[0].questionId, 'q1');
    assert.equal(request.generationConfig.responseMimeType, 'application/json');
    assert.throws(() => sourceQuestions(Array(31).fill({})), /30/);
    assert.throws(() => generationRequest(sources, 'x'.repeat(4001)), /4000/);
    assert.throws(() => generationRequest([], '  '), /錯題/);
    assert.throws(() => sourceQuestions([]), /錯題/);
    assert.throws(() => generationRequest([], '生成英文水果單字卡'), /錯題/);
    assert.doesNotThrow(() => generationRequest(sources));
});
test('generated content saves as native Flashcard fields with aliases and source attribution', () => {
    const result = parse(), saved = prepareDeck(result);
    assert.equal(saved.cards[0].term, card.term);
    assert.equal(saved.cards[0].definition, '32:1');
    assert.deepEqual(saved.cards[0].definitionAliases, ['32 to 1']);
    assert.equal(saved.termLanguage, 'zh-TW');
    assert.match(saved.description, /錯題來源：檢驗學/);
    assert.equal(saved.cards[0].revision, 1);
    assert.equal('front' in saved.cards[0], false);
    assert.throws(() => parse({ ...deck, cards: [{ ...card, sourceIds: [] }] }, []), /錯題/);
});
test('malformed, incomplete, duplicate and unlinked generated decks cannot be saved', () => {
    for (const changes of [{ sourceIds: [] }, { sourceIds: ['invented'] }, { sourceIds: null }, { term: '' }, { definition: 'x'.repeat(4001) }, { termAliases: [''] }, { definitionAliases: Array(13).fill('a') }]) {
        assert.throws(() => parse({ ...deck, cards: [{ ...card, ...changes }] }));
    }
    for (const changes of [{ title: '' }, { title: 'x'.repeat(161) }, { description: null }, { termLanguage: '' }, { cards: [] }, { cards: [card, { ...card, term: `  ${card.term} ` }] }, { cards: Array(31).fill(card) }]) assert.throws(() => parse({ ...deck, ...changes }));
    assert.throws(() => parse(null));
    assert.throws(() => parseGeneratedDeck('broken JSON', sources));
    assert.throws(() => parse(deck, []));
});
