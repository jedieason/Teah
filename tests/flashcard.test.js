import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTIONS, parseImport, parseImportJson, FLASHCARD_IMPORT_PROMPT, prepareDeck, gradeAnswer, createSession, submitAnswer, advanceSession, continueRound, overrideCorrect, projectStudy, mergeStudy, sessionProgress, hydrateSession, writingHint, writingSymbols, spellingFeedback, defaultGrading, gradingFor } from '../src/features/flashcard/model.js';
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
    assert.equal(parseImport('apple\tn. 蘋果\\n甜甜白白的').cards[0].definition, 'n. 蘋果\n甜甜白白的');
    assert.throws(() => parseImport('a', { term: 'custom', termCustom: '', row: 'newline' }));
    assert.throws(() => parseImport('a', { term: 'custom', termCustom: '\\t', row: 'custom', rowCustom: '\t' }));
    assert.throws(() => parseImport(Array(2002).fill('a\tb').join('\n')));
});
test('JSON import parses AI generated cards, handles markdown code fences, and decodes newlines and aliases', () => {
    assert.match(FLASHCARD_IMPORT_PROMPT, /"term"/);
    assert.match(FLASHCARD_IMPORT_PROMPT, /\\n/);
    assert.match(FLASHCARD_IMPORT_PROMPT, /蘋果/);

    const jsonSnippet = `[
        { "term": "apple", "definition": "n. 蘋果\\n甜甜白白的" },
        { "term": "banana", "definition": "香蕉", "termAliases": ["bananas"], "definitionAliases": ["芎蕉"] }
    ]`;
    const res = parseImport(jsonSnippet, { format: 'json' });
    assert.equal(res.cards.length, 2);
    assert.equal(res.cards[0].term, 'apple');
    assert.equal(res.cards[0].definition, 'n. 蘋果\n甜甜白白的');
    assert.deepEqual(res.cards[1].definitionAliases, ['芎蕉']);

    // Markdown code fences
    const fenced = '```json\n[{"term":"car","definition":"汽車"}]\n```';
    assert.equal(parseImportJson(fenced).cards[0].term, 'car');

    // Object with cards array
    const objWithCards = JSON.stringify({ cards: [{ term: 'dog', definition: '狗' }] });
    assert.equal(parseImportJson(objWithCards).cards[0].definition, '狗');

    // Literal and unescaped newlines
    const multiLineDef = JSON.stringify([{ term: 'cat', definition: 'n. 貓\n可愛的動物' }]);
    assert.equal(parseImportJson(multiLineDef).cards[0].definition, 'n. 貓\n可愛的動物');

    // Duplicate detection and empty handling
    assert.equal(parseImportJson('').cards.length, 0);
    assert.equal(parseImportJson('[{"term":"a","definition":"b"},{"term":"a","definition":"b"}]').duplicates, 1);

    // Errors for invalid format or missing sides
    assert.equal(parseImportJson('[{"term":"only"}]').errors.length, 1);
    assert.throws(() => parseImportJson('{ invalid json }'));
    assert.throws(() => parseImportJson('"not an array or card object"'));
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
    assert.equal(gradeAnswer('Intradermal nevus', ['Intradermal (melanocytic) nevus']), true);
    assert.equal(gradeAnswer('Intradermal melanocytic nevus', ['Intradermal (melanocytic) nevus']), true);
    assert.equal(gradeAnswer('Intradermal (melanocytic) nevus', ['Intradermal (melanocytic) nevus']), true);
    assert.equal(gradeAnswer('皮內痣', ['皮內痣（黑色素細胞痣）']), true);
    assert.equal(gradeAnswer('皮內痣黑色素細胞痣', ['皮內痣（黑色素細胞痣）']), true);
    assert.equal(gradeAnswer('Endocarditis infective', ['Endocarditis, infective']), true);
    assert.equal(gradeAnswer('Type 1 Diabetes', ['Type 1: Diabetes']), true);
    assert.equal(gradeAnswer('Non Hodgkin lymphoma', ['Non-Hodgkin lymphoma']), true);
});
test('Learn spaces recognition misses and reaches recall mastery through bounded windows', () => {
    const d = deck(); let s = createSession(d, {}, { shuffle: false, types: ['choice', 'written'], retype: false }, 0, () => .4);
    const first = s.current.cardId; s = step(s, d, 'wrong');
    const intervening = [];
    while (s.current.cardId !== first && intervening.length < 10) { intervening.push(s.current.cardId); s = step(s, d, response(s, d)); if (s.checkpoint) s = continueRound(s, d); }
    assert.ok(intervening.length >= 2, 'wrong card must be spaced by other questions');
    assert.equal(s.current.cardId, first); assert.equal(s.current.type, 'choice');
    let guard = 0, checkpoint = false, written = false;
    while (!s.completed && guard++ < 150) { if (s.current?.type === 'written') written = true; s = step(s, d, response(s, d)); if (s.checkpoint) { checkpoint = true; if (s.roundRepair) assert.ok(s.active.every(k => s.facts[k].stage >= s.chunkGoals[k])); else assert.equal(s.roundSeen.length, s.active.length); s = continueRound(s, d); } }
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
    const rejected = overrideCorrect(override, 2000, false); assert.equal(rejected.facts[key].correct, 0); assert.equal(rejected.facts[key].wrong, 1); assert.equal(rejected.ordinal, 1); assert.equal(rejected.feedback.retyped, false);
});
test('ten new terms precede recall; a failed recall retains credit and is prioritized in the next mixed round', () => {
    const d = deck(); let s = createSession(d, {}, { types: ['choice', 'written'], retype: false });
    const visited = [];
    for (let i = 0; i < 10; i++) {
        if (s.checkpoint) s = continueRound(s, d);
        assert.equal(s.current.type, 'choice'); assert.equal(s.current.cardId, d.cards[i].id);
        visited.push(s.current.cardId); s = step(s, d, response(s, d));
    }
    assert.equal(s.current.type, 'written'); assert.equal(s.current.cardId, d.cards[0].id);
    const before = sessionProgress(s).earned, failedKey = s.current.key;
    s = step(s, d, 'wrong'); assert.equal(s.facts[failedKey].stage, 1); assert.equal(sessionProgress(s).earned, before);
    while (!s.checkpoint) { assert.notEqual(s.current.key, failedKey); s = step(s, d, response(s, d)); }
    s = continueRound(s, d); assert.equal(s.current.key, failedKey); assert.equal(s.current.type, 'written');
    s = step(s, d, response(s, d));
    let guard = 0;
    while (!s.completed && guard++ < 80) { if (s.checkpoint) s = continueRound(s, d); else s = step(s, d, response(s, d)); }
    assert.equal(sessionProgress(s).earned, 34); assert.equal(sessionProgress(s).mastered, 16); assert.equal(s.completed, true);
});
test('binary explanations become two choices while written answers still require their explanation', () => {
    const d = prepareDeck({ title: 'Binary', cards: [{ term: 'Randomized?', definition: 'Yes, because treatments were assigned randomly.' }] });
    let s = createSession(d, {}, { direction: 'definition', types: ['choice', 'written'] });
    assert.deepEqual(s.current.choices, ['Yes', 'No']); assert.equal(s.current.choiceAnswer, 'Yes');
    s = submitAnswer(s, d, 'Yes'); assert.equal(s.feedback.correct, true);
    assert.equal(sessionProgress(s).earned, 1); assert.equal(sessionProgress(s).displayedEarned, 0);
    s = advanceSession(s, d); s = continueRound(s, d); assert.equal(s.current.type, 'written');
    assert.equal(submitAnswer(s, d, 'Yes').feedback.correct, false);
    const phrase = prepareDeck({ title: 'Phrase', cards: [{ term: 'no longer', definition: '不再' }] });
    assert.equal(createSession(phrase, {}, { types: ['choice'] }).current.type, 'written', 'a vocabulary phrase beginning with no must retain the full answer');
});
test('writing hints preserve observed partial patterns; input palette follows the answer direction', () => {
    assert.equal(writingHint('0.01 < p-value < 0.02'), '0.01 < ______ ___');
    assert.equal(writingHint('Yes, since both histograms have no outliers.'), '');
    assert.equal(writingHint('17'), '');
    assert.equal(writingHint('Reject H0 and conclude that those who drink no beer have a shorter mean reaction times, on average, than those who drink two cans of beers.'), 'Reject H0 and conclude that those who drink no beer have a shorter...');
    const d = prepareDeck({ title: 'Symbols', cards: [{ term: 'μM', definition: '大小比較 ≤' }, { term: 'μg', definition: '劑量' }] });
    assert.deepEqual(writingSymbols(d, 'term'), ['μ']); assert.deepEqual(writingSymbols(d, 'definition'), ['≤']);
});
test('events replay chronologically across offline/concurrent delivery; retries, repairs and overrides never double count', () => {
    const events = [1, 2, 3].map(n => ({ id: 'a' + n, at: n, kind: 'answer', cardId: 'c', revision: 1, direction: 'term', correct: n !== 2, generation: 'initial', ordinal: n }));
    let study = {};
    for (const e of [events[2], events[0], events[1], events[0]]) study = mergeStudy(study, e);
    assert.equal(projectStudy(study).facts.c_term.stage, 1); assert.equal(projectStudy(study).facts.c_term.credit, 2);
    study = mergeStudy(study, { id: 'repair', kind: 'repair', at: 4 }); assert.equal(projectStudy(study).correct, 2);
    study = mergeStudy(study, { id: 'override', kind: 'override', at: 5, originalId: 'a2', correct: true });
    assert.equal(projectStudy(study).correct, 3); assert.equal(projectStudy(study).wrong, 0); assert.equal(projectStudy(study).facts.c_term.stage, 2);
    assert.deepEqual(projectStudy(study), projectStudy({ events: Object.fromEntries(Object.values(study.events).reverse().map(e => [e.id, e])) }));
    study = mergeStudy(study, { id: 'incorrect', kind: 'override', at: 5.5, originalId: 'a3', correct: false });
    assert.equal(projectStudy(study).correct, 2); assert.equal(projectStudy(study).wrong, 1); assert.equal(projectStudy(study).facts.c_term.stage, 1);
    study = mergeStudy(study, { id: 'reset', kind: 'reset', at: 6, generation: 'fresh' });
    assert.deepEqual(projectStudy(study).facts, {});
    study = mergeStudy(study, { ...events[0], id: 'late', at: 7 }); assert.deepEqual(projectStudy(study).facts, {});
});
test('completed progress and consecutive mastery are independent; continuous practice remains usable', () => {
    const d = deck(3); let s = createSession(d, {}, { types: ['written'] });
    const events = []; let at = 100;
    while (!s.completed) {
        if (s.checkpoint) { s = continueRound(s, d); continue; }
        const q = s.current, c = d.cards.find(c => c.id === q.cardId);
        events.push({ id: 'e' + at, kind: 'answer', at: at++, cardId: c.id, revision: c.revision, direction: q.direction, correct: true, ordinal: s.ordinal + 1 });
        s = step(s, d, response(s, d));
    }
    let study = { events: Object.fromEntries(events.map(e => [e.id, e])) };
    s = createSession(d, study, { practice: true, types: ['written'] }, at, () => .4);
    assert.equal(s.completed, false); const missed = s.current.key;
    s = step(s, d, 'wrong'); assert.equal(s.facts[missed].stage, 1); assert.equal(s.facts[missed].credit, 2); assert.equal(sessionProgress(s).earned, 6);
    for (let i = 0; i < 25; i++) { assert.equal(s.checkpoint, false); s = step(s, d, response(s, d)); }
    assert.equal(s.completed, false); assert.equal(s.roundAnswers.length, 20); assert.equal(s.facts[missed].stage, 2);
    const wire = JSON.parse(JSON.stringify(s)); delete wire.practiceQueue; assert.deepEqual(hydrateSession(wire).practiceQueue, []);
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
test('Write traverses the full set before retrying misses and requires two new correct responses per run', () => {
    const d = deck(), events = {};
    d.cards.forEach((card, i) => { for (let n = 0; n < 2; n++) { const id = `old${i}-${n}`; events[id] = { id, kind: 'answer', at: i * 2 + n, cardId: card.id, direction: 'term', revision: 1, correct: true }; } });
    let s = createSession(d, { events }, { activity: 'write', goal: 'quick', chunkSize: 5 });
    assert.equal(s.completed, false); assert.equal(sessionProgress(s).earned, 0); assert.equal(s.options.goal, 'master'); assert.equal(s.active.length, 17);
    for (let i = 0; i < 17; i++) {
        assert.equal(s.current.cardId, d.cards[i].id); assert.equal(s.current.type, 'written');
        s = step(s, d, i === 0 || i === 2 ? 'wrong' : response(s, d));
        assert.equal(s.checkpoint, i === 16, 'no seven-question checkpoint or same-pass retry');
    }
    assert.equal(sessionProgress(s).earned, 15); assert.equal(s.roundAnswers.length, 17);
    s = continueRound(s, d); assert.equal(s.current.cardId, d.cards[0].id);
    s = step(s, d, response(s, d)); assert.equal(s.current.cardId, d.cards[2].id);
    while (!s.checkpoint) s = step(s, d, response(s, d));
    assert.equal(sessionProgress(s).earned, 32); assert.equal(s.completed, false);
    s = continueRound(s, d); assert.equal(s.active.length, 2);
    s = step(s, d, response(s, d)); s = step(s, d, response(s, d));
    assert.equal(s.completed, true); assert.equal(sessionProgress(s).earned, 34);
});
test('Write override and wire hydration preserve independent run credits without a second attempt', () => {
    const d = deck(1); let s = createSession(d, {}, { activity: 'write' });
    s = submitAnswer(s, d, 'wrong'); assert.equal(sessionProgress(s).earned, 0);
    s = overrideCorrect(s); assert.equal(sessionProgress(s).earned, 1); assert.equal(sessionProgress(s).displayedEarned, 0);
    s = overrideCorrect(s, 1000, false); assert.equal(sessionProgress(s).earned, 0); assert.equal(s.ordinal, 1);
    const wire = JSON.parse(JSON.stringify(s)); delete wire.passMisses; assert.deepEqual(hydrateSession(wire).passMisses, []);
    s = advanceSession(hydrateSession(wire), d); assert.equal(s.checkpoint, true);
    s = continueRound(s, d); s = step(s, d, response(s, d)); assert.equal(s.completed, false);
    s = continueRound(s, d); s = step(s, d, response(s, d)); assert.equal(s.completed, true);
});
test('Spell repeats a miss without awarding repair credit, traverses full passes, and always grades spelling strictly', () => {
    const d = deck(8); let s = createSession(d, {}, { activity: 'spell', grading: 'relaxed' });
    const key = s.current.key; assert.equal(gradingFor(s, d), 'exact');
    s = step(s, d, 'wrong'); assert.equal(s.current.key, key); assert.equal(sessionProgress(s).earned, 0); assert.equal(s.checkpoint, false);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 8; i++) {
        assert.equal(s.current.cardId, d.cards[i].id); assert.equal(s.current.type, 'spell');
        s = step(s, d, response(s, d)); assert.equal(s.checkpoint, false);
    }
    assert.equal(s.completed, true); assert.equal(sessionProgress(s).earned, 16);
    assert.deepEqual(spellingFeedback('aple', 'apple').expected.filter(p => p.incorrect), [{ text: 'p', incorrect: true }]);
    assert.deepEqual(spellingFeedback('catz', 'cats').response.filter(p => p.incorrect), [{ text: 'z', incorrect: true }]);
    assert.equal(spellingFeedback('μg', 'μg').expected.some(p => p.incorrect), false);
    assert.equal(spellingFeedback('a'.repeat(4000), 'b'.repeat(4000)).expected.length, 1);
});
test('default grading follows set language, size and default language; accents and omitted letters are moderate errors', () => {
    const same = prepareDeck({ title: 'Same language', termLanguage: 'en-US', definitionLanguage: 'en-GB', cards: [{ term: 'apple', definition: 'fruit' }, { term: 'car', definition: 'vehicle' }, { term: 'pear', definition: 'fruit' }] });
    assert.equal(defaultGrading(same, 'en-GB'), 'relaxed'); assert.equal(defaultGrading(same, 'zh-TW'), 'moderate');
    assert.equal(defaultGrading({ ...same, cards: same.cards.slice(0, 2) }, 'en-US'), 'moderate');
    assert.equal(defaultGrading(deck(), 'en-US'), 'strict');
    for (const language of ['zh-TW', 'ja-JP', 'math']) assert.equal(defaultGrading({ ...same, termLanguage: language, definitionLanguage: language }), 'strict');
    assert.equal(gradeAnswer('cafe', ['café'], 'moderate'), true); assert.equal(gradeAnswer('ct', ['cat'], 'moderate'), true);
    assert.equal(gradeAnswer('bat', ['cat'], 'moderate'), false); assert.equal(gradeAnswer('café', ['cafe']), false);
});
test('choice options and heard spelling cannot use written typo tolerance or semantic aliases', () => {
    const d = prepareDeck({ title: 'Nearby spellings', cards: [{ term: 'car', definition: '汽車', termAliases: ['automobile'] }, { term: 'care', definition: '關心' }, { term: 'cat', definition: '貓' }] });
    const choice = createSession(d, {}, { grading: 'moderate', types: ['choice'] });
    assert.ok(choice.current.choices.includes('care')); assert.equal(submitAnswer(choice, d, 'care').feedback.correct, false);
    const spell = createSession(d, {}, { activity: 'spell', grading: 'moderate' });
    assert.equal(submitAnswer(spell, d, 'automobile').feedback.correct, false); assert.equal(submitAnswer(spell, d, 'care').feedback.correct, false);
    const write = createSession(d, {}, { activity: 'write' }); assert.equal(submitAnswer(write, d, 'automobile').feedback.correct, true);
    const overridden = overrideCorrect(submitAnswer(spell, d, 'wrong', 100), 5000);
    assert.equal(overridden.facts[overridden.current.key].lastAt, 100, 'correction time must not become retrieval time');
});
test('audio and audioAnswer preferences are preserved in session options', () => {
    assert.equal(DEFAULT_OPTIONS.audio, false);
    assert.equal(DEFAULT_OPTIONS.audioAnswer, false);
    const s = createSession(deck(2), {}, { audio: true, audioAnswer: true });
    assert.equal(s.options.audio, true);
    assert.equal(s.options.audioAnswer, true);
});

test('undoing flash classifications restores the previous rating without contributing Learn credit', () => {
    const d = deck(1), card = d.cards[0];
    const event = (id, at, correct, extra = {}) => ({ id, at, kind: 'flash', cardId: card.id, direction: 'term', revision: card.revision, sessionId: 'flash-session', correct, ...extra });
    const old = event('old', 1, false), known = event('known', 2, true), undo = event('undo', 3, true, { originalId: 'known', value: false });
    const study = { events: { old, known, undo } }, projected = projectStudy(study);
    assert.equal(projected.flash[`${card.id}_term`].known, false);
    assert.equal(projected.correct, 0); assert.equal(projected.wrong, 0);
    assert.equal(createSession(d, study).facts[`${card.id}_term`].credit, 0);
    const only = projectStudy({ events: { known, undo } });
    assert.equal(only.flash[`${card.id}_term`], undefined);
    // Offline order and duplicate undo replay produce the same projection.
    assert.deepEqual(projectStudy({ events: { undo, known, old } }), projected);
    assert.deepEqual(projectStudy({ events: { old, known, undo, again: { ...undo, id: 'undo-again', at: 4 } } }), projected);
});
test('multiline definitions and terms match answers with newlines and ignore whitespace differences', () => {
    const card = { term: 'DNA\nRNA', definition: 'Deoxyribonucleic acid\nRibonucleic acid' };
    assert.equal(gradeAnswer('DNA\nRNA', [card.term]), true);
    assert.equal(gradeAnswer('DNA RNA', [card.term]), true);
    assert.equal(gradeAnswer('Deoxyribonucleic acid\nRibonucleic acid', [card.definition]), true);
    assert.equal(gradeAnswer('Deoxyribonucleic acid Ribonucleic acid', [card.definition]), true);
});
test('public deck toggle and author metadata are preserved and bounded in prepareDeck', () => {
    const draft = {
        title: 'Public Deck',
        cards: [{ term: 'mitochondria', definition: 'powerhouse of the cell' }],
        isPublic: true,
        authorId: 'user_123',
        authorName: 'Dr. Smith',
        authorPhoto: 'https://example.com/avatar.jpg'
    };
    const deck = prepareDeck(draft);
    assert.equal(deck.isPublic, true);
    assert.equal(deck.authorId, 'user_123');
    assert.equal(deck.authorName, 'Dr. Smith');
    assert.equal(deck.authorPhoto, 'https://example.com/avatar.jpg');

    // Updating deck preserves author and toggles isPublic
    const updated = prepareDeck({ ...deck, title: 'Updated Title', isPublic: false }, deck);
    assert.equal(updated.isPublic, false);
    assert.equal(updated.authorId, 'user_123');
    assert.equal(updated.authorName, 'Dr. Smith');
    assert.equal(updated.authorPhoto, 'https://example.com/avatar.jpg');
    assert.equal(updated.revision, 2);
});


