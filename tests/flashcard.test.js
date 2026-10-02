import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, prepareDeck, gradeAnswer, createSession, submitAnswer, advanceSession, continueRound, overrideCorrect, projectStudy, mergeStudy, sessionProgress, hydrateSession } from '../src/features/flashcard/model.js';
const deck = (n = 17) => prepareDeck({ title: 'Test', cards: Array.from({ length: n }, (_, i) => ({ term: `word${i}`, definition: `解釋${i}` })) });
function response(s, d) { const c = d.cards.find(c => c.id === s.current.cardId); return s.current.type === 'multi' ? s.current.correctAnswers : s.current.direction === 'term' ? c.term : c.definition; }
function step(s, d, input, at = 1000) { const answered = submitAnswer(s, d, input, at); return advanceSession(answered, d, at + 1, () => .4); }
test('paste import supports CRLF, comma/tab/dash/custom delimiters and preserves trailing definition punctuation', () => {
    assert.deepEqual(parseImport('apple,蘋果,水果\r\nbanana,香蕉\r\n', { term: 'comma', row: 'newline' }).cards, [{ term: 'apple', definition: '蘋果,水果' }, { term: 'banana', definition: '香蕉' }]);
    assert.equal(parseImport('apple::red\nfruit||banana::yellow', { term: 'custom', termCustom: '::', row: 'custom', rowCustom: '||' }).cards[0].definition, 'red\nfruit');
    assert.equal(parseImport('\uFEFFapple\t蘋果;banana\t香蕉', { term: 'tab', row: 'semicolon' }).cards.length, 2);
    assert.equal(parseImport('word - meaning', { term: 'dash', row: 'newline' }).cards[0].definition, 'meaning');
    assert.equal(parseImport('missing\nword,', { term: 'comma', row: 'newline' }).errors.length, 2);
    assert.equal(parseImport('a\tb\na\tb').duplicates, 1);
    assert.throws(() => parseImport('a', { term: 'custom', termCustom: '', row: 'newline' }));
    assert.throws(() => parseImport('a', { term: 'custom', termCustom: '\\t', row: 'custom', rowCustom: '\t' }));
    assert.throws(() => parseImport(Array(2002).fill('a\tb').join('\n')));
});
test('stable card IDs and revisions invalidate only changed content, not rearrangement or metadata', () => {
    const d = deck(3), edited = prepareDeck({ ...d, title: 'Renamed', cards: [d.cards[2], d.cards[0], d.cards[1]] }, d);
    assert.deepEqual(edited.cards.map(c => c.revision), [1, 1, 1]);
    edited.cards[1].definition += 'changed'; const changed = prepareDeck(edited, d);
    assert.equal(changed.cards[1].revision, 2); assert.equal(changed.cards[0].id, d.cards[2].id);
    assert.throws(() => prepareDeck({ title: 'No', cards: [{ term: 'a', definition: '' }] }));
});
test('grading handles explicit aliases and formatting but never equates meaningful medical/math differences', () => {
    assert.equal(gradeAnswer('ＡＰＰＬＥ!', ['**apple**']), true);
    assert.equal(gradeAnswer('hypokalemia', ['Hypokalaemia'], 'moderate'), true);
    assert.equal(gradeAnswer('mild', ['severe']), false);
    assert.equal(gradeAnswer('5 mg', ['50 mg'], 'moderate'), false);
    assert.equal(gradeAnswer('pH > 6.5', ['pH < 6.5']), false);
    assert.equal(gradeAnswer('32 / 1', ['32:1']), false);
    assert.equal(gradeAnswer('CD4-', ['CD4+']), false);
});
test('Learn repairs the whole seven-term chunk before checkpoint and advances recognition to recall', () => {
    const d = deck(); let s = createSession(d, {}, { shuffle: false, types: ['choice', 'written'], retype: false }, 0, () => .4);
    const first = s.current.cardId; s = step(s, d, 'wrong');
    const intervening = [];
    while (s.current.cardId !== first && intervening.length < 10) { intervening.push(s.current.cardId); s = step(s, d, response(s, d)); if (s.checkpoint) s = continueRound(s, d); }
    assert.ok(intervening.length >= 2, 'wrong card must be spaced by other questions');
    assert.equal(s.current.cardId, first); assert.equal(s.current.type, 'choice');
    let guard = 0, checkpoint = false, written = false;
    while (!s.completed && guard++ < 150) { if (s.current?.type === 'written') written = true; s = step(s, d, response(s, d)); if (s.checkpoint) { checkpoint = true; assert.ok(s.active.every(k => s.facts[k].stage >= s.chunkGoals[k])); s = continueRound(s, d); } }
    assert.equal(s.completed, true); assert.equal(sessionProgress(s).mastered, 17); assert.ok(written && checkpoint);
});
test('observed Quizlet trace: two misses in seven new terms extend the round to nine attempts, then introduce the next group', () => {
    const d = deck(), visited = []; let s = createSession(d, {}, { types: ['choice', 'written'], shuffle: false, retype: false });
    for (let i = 0; i < 7; i++) { visited.push(s.current.cardId); s = step(s, d, i === 0 || i === 2 ? 'wrong' : response(s, d)); }
    assert.equal(new Set(visited).size, 7); assert.equal(s.checkpoint, false); assert.equal(s.current.cardId, visited[0]);
    s = step(s, d, response(s, d)); assert.equal(s.current.cardId, visited[2]);
    s = step(s, d, response(s, d)); assert.equal(s.checkpoint, true); assert.equal(s.roundAnswers.length, 9); assert.equal(sessionProgress(s).percent, 21);
    s = continueRound(s, d); assert.equal(s.current.cardId, d.cards[7].id); assert.equal(s.current.type, 'choice');
});
test('retyping is a repair, not a graded retrieval; manual override counts only one original response', () => {
    const d = deck(3); let s = createSession(d, {}, { types: ['written'], retype: true });
    s = submitAnswer(s, d, 'bad'); assert.equal(advanceSession(s, d), s);
    const key = s.current.key; assert.equal(s.facts[key].stage, 0);
    const corrected = { ...s, feedback: { ...s.feedback, retyped: true } };
    const next = advanceSession(corrected, d); assert.equal(next.facts[key].stage, 0);
    const override = overrideCorrect(s); assert.equal(override.facts[key].correct, 1); assert.equal(override.facts[key].wrong, 0); assert.equal(override.ordinal, 1);
});
test('events replay chronologically across offline/concurrent delivery; retries, repairs and overrides never double count', () => {
    const events = [1, 2, 3].map(n => ({ id: 'a' + n, at: n, kind: 'answer', cardId: 'c', revision: 1, direction: 'term', correct: n !== 2, generation: 'initial', ordinal: n }));
    let study = {};
    for (const e of [events[2], events[0], events[1], events[0]]) study = mergeStudy(study, e);
    assert.equal(projectStudy(study).facts.c_term.stage, 1);
    study = mergeStudy(study, { id: 'repair', kind: 'repair', at: 4 }); assert.equal(projectStudy(study).correct, 2);
    study = mergeStudy(study, { id: 'override', kind: 'override', at: 5, originalId: 'a2', correct: true });
    assert.equal(projectStudy(study).correct, 3); assert.equal(projectStudy(study).wrong, 0); assert.equal(projectStudy(study).facts.c_term.stage, 2);
    assert.deepEqual(projectStudy(study), projectStudy({ events: Object.fromEntries(Object.values(study.events).reverse().map(e => [e.id, e])) }));
    study = mergeStudy(study, { id: 'reset', kind: 'reset', at: 6, generation: 'fresh' });
    assert.deepEqual(projectStudy(study).facts, {});
    study = mergeStudy(study, { ...events[0], id: 'late', at: 7 }); assert.deepEqual(projectStudy(study).facts, {});
});
test('direction, star scope, small sets, equal answers and changed revisions remain independent', () => {
    const d = deck(1), both = createSession(d, {}, { direction: 'both' });
    assert.equal(both.order.length, 2); assert.equal(both.current.type, 'written');
    let s = createSession(d); s = step(s, d, response(s, d)); s = continueRound(s, d); s = step(s, d, response(s, d)); assert.equal(s.completed, true);
    const e = { id: 'e', kind: 'answer', at: 1, cardId: d.cards[0].id, revision: 1, direction: 'term', correct: true };
    const data = mergeStudy({}, e); const changed = prepareDeck({ ...d, cards: [{ ...d.cards[0], term: 'changed' }] }, d);
    assert.equal(createSession(changed, data).facts[changed.cards[0].id + '_term'].stage, 0);
    assert.throws(() => createSession(d, data, { scope: 'starred' }));
    const hydrated = hydrateSession({ mode: 'learn', order: ['a'], options: { types: ['choice'] }, facts: {} }); assert.deepEqual(hydrated.roundAnswers, []);
});
test('select all accepts exactly the valid answers and excludes ambiguous distractors', () => {
    const d = prepareDeck({ title: 'Synonyms', cards: [{ term: 'car', definition: '汽車', termAliases: ['automobile'] }, { term: 'apple', definition: '蘋果' }, { term: 'pear', definition: '梨' }] });
    const s = createSession(d, {}, { types: ['multi'], shuffle: false }, 1, () => .3);
    assert.equal(s.current.type, 'multi'); assert.deepEqual([...s.current.correctAnswers].sort(), ['automobile', 'car']);
    assert.equal(submitAnswer(s, d, ['car']).feedback.correct, false);
    assert.equal(submitAnswer(s, d, ['car', 'automobile']).feedback.correct, true);
});
