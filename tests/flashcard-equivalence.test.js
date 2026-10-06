import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeEquivalence, criticalConflict } from '../src/features/flashcard/equivalence.js';
import { gradingLevel, gradingOptions, GRADING_LEVELS } from '../src/features/flashcard/grading-options.js';
import { createSession, prepareDeck, submitAnswer, overrideCorrect, hydrateSession } from '../src/features/flashcard/model.js';
import { nliScores } from '../src/features/flashcard/equivalence-worker.js';
import { conceptIndex, compareConcepts } from '../src/features/flashcard/terminology.js';

const scores = (entailment, contradiction = .001) => ({ forward: { entailment, contradiction }, backward: { entailment, contradiction } });
const grade = (expected, response, grading = 'standard', infer = async () => scores(.99), extra = {}) => gradeEquivalence({ expected, response, grading, ...extra }, infer, async () => null);

test('four levels migrate former settings and remove the Gemini switch', () => {
    assert.equal(GRADING_LEVELS.length, 4);
    assert.equal(gradingLevel('strict'), 'exact');
    assert.equal(gradingLevel('moderate'), 'standard');
    assert.equal(gradingLevel('auto'), 'standard');
    assert.deepEqual(gradingOptions({ grading: 'relaxed', useGemini: true }), { grading: 'relaxed' });
    const d = prepareDeck({ title: 'Test', cards: [{ term: 'car', definition: 'vehicle' }] });
    const s = createSession(d, {}, { grading: 'strict', useGemini: true });
    assert.equal(s.options.grading, 'exact'); assert.equal('useGemini' in s.options, false);
    assert.equal(hydrateSession({ ...s, options: { ...s.options, grading: 'auto', useGemini: true } }).options.grading, 'standard');
});

test('exact ignores formatting, case and spaces without invoking a model or omitting words', async () => {
    const never = () => { throw new Error('Exact must not run inference'); };
    assert.equal((await grade('**Myocardial Infarction**', 'ＭＹＯＣＡＲＤＩＡＬinfARction!', 'exact', never)).correct, true);
    assert.equal((await grade('Intradermal (melanocytic) nevus', 'Intradermal nevus', 'exact', never)).correct, false);
    assert.equal((await grade('car', 'automobile', 'exact', never)).correct, false);
    assert.equal((await grade('car', 'automobile', 'exact', never, { aliases: ['automobile'] })).correct, true);
    assert.equal((await grade('anything', '', 'relaxed', never)).reason, 'empty');
});

test('critical conflicts cannot be accepted even by a very confident model', async () => {
    const pairs = [['5 mg', '50 mg'], ['5 mg', '5 g'], ['.5 mg', '5 mg'], ['5 mg, 50 g', '50 mg, 5 g'], ['pH > 6.5', 'pH < 6.5'], ['32:1', '32/1'], ['CD4+', 'CD4-'], ['Na+', 'K+'], ['Na+ K-', 'Na- K+'], ['2*x*3', '2x3'], ['x^2', 'x2'], ['IgG', 'IgM'], ['T1', 'T2'], ['hyperkalemia', 'hypokalemia'], ['hypertrophy', 'hyperplasia'], ['ileum', 'ilium'], ['agonist', 'antagonist'], ['acute inflammation', 'chronic inflammation'], ['benign tumor', 'malignant tumor'], ['activation', 'no activation'], ['陽性', '陰性'], ['血鉀升高', '血鉀降低']];
    for (const [reference, response] of pairs) {
        assert.ok(criticalConflict(reference, response), `${reference} / ${response}`);
        for (const level of GRADING_LEVELS.map(([level]) => level)) {
            let called = false;
            const result = await grade(reference, response, level, () => { called = true; return scores(.999); });
            assert.equal(result.correct, false); assert.equal(called, false);
        }
    }
});

test('cancellation also interrupts terminology loading before starting the model', async () => {
    const controller = new AbortController(); let called = false;
    const pending = gradeEquivalence({ expected: 'infarction', response: 'infarct', signal: controller.signal }, () => { called = true; return scores(.99); }, () => new Promise(() => {}));
    controller.abort();
    assert.equal((await pending).reason, 'cancelled'); assert.equal(called, false);
});

test('aliases are evaluated independently and contradictions stay in the full response', async () => {
    assert.equal((await grade('positive', 'negative', 'standard', undefined, { aliases: ['negative'] })).correct, true);
    assert.equal((await grade('activation', 'activation (not)', 'relaxed')).correct, false);
    assert.equal((await grade('diabetes (type 1)', 'diabetes', 'relaxed')).correct, false);
    assert.equal((await grade('Non-Hodgkin lymphoma', 'non Hodgkin lymphoma', 'exact')).correct, true);
});

test('official MeSH concepts accept synonyms while distinguishing related concepts and ambiguous names', async () => {
    const data = JSON.parse(readFileSync(new URL('../src/features/flashcard/data/mesh-concepts.json', import.meta.url)));
    const index = conceptIndex(data);
    assert.equal(data.year, 2026); assert.ok(data.concepts.length > 60000);
    const terminology = async (a, b) => compareConcepts(index, a, b);
    const never = () => { throw new Error('Resolved terms must not run the model'); };
    for (const [expected, response] of [['infarction', 'infarct'], ['myocardial infarction', 'myocardial infarct'], ['myocardial infarction', 'heart attack'], ['metastasis', 'metastases']]) {
        const result = await gradeEquivalence({ expected, response }, never, terminology);
        assert.equal(result.reason, 'same-concept', `${expected} / ${response}`);
        assert.equal(result.correct, true);
    }
    for (const [expected, response] of [['infarction', 'ischemia'], ['infarction', 'necrosis'], ['programmed cell death', 'apoptosis']]) {
        assert.equal((await gradeEquivalence({ expected, response }, never, terminology)).correct, false);
    }
    const ambiguous = conceptIndex({ concepts: [['A', ['MI', 'myocardial infarction']], ['B', ['MI', 'mitral insufficiency']]] });
    assert.equal(compareConcepts(ambiguous, 'MI', 'myocardial infarction'), null);
    let calls = 0;
    assert.equal((await gradeEquivalence({ expected: 'myocardial infarction', response: 'MI' }, async () => { calls++; return scores(.6); }, async (a, b) => compareConcepts(ambiguous, a, b))).status, 'uncertain');
    assert.equal(calls, 1);
});

test('levels use both entailment directions and never accept spelling or morphology alone', async () => {
    assert.equal((await grade('infarction', 'infarct', 'relaxed', async () => scores(.85))).correct, true);
    assert.equal((await grade('infarction', 'infarct', 'standard', async () => scores(.85))).status, 'uncertain');
    assert.equal((await grade('infarction', 'infarct', 'standard', async () => scores(.94))).correct, true);
    assert.equal((await grade('infarction', 'infarct', 'rigorous', async () => scores(.94))).correct, false);
    assert.equal((await grade('infarction', 'infarct', 'rigorous', async () => scores(.99))).correct, true);
    assert.equal((await grade('thrombus', 'thrombi', 'relaxed', async () => scores(.1))).correct, false);
    assert.equal((await grade('infarction', 'ischemia', 'relaxed', async () => scores(.99, .6))).correct, false);
    assert.equal((await grade('renal failure', 'failure', 'relaxed', async () => ({ ...scores(.99), backward: { entailment: .1, contradiction: .01 } }))).correct, false);
});

test('context is sent to local inference; unavailable, oversized or invalid inference is uncertain', async () => {
    const result = await grade('kidney', 'renal', 'standard', async pair => {
        assert.equal(pair.prompt, 'What organ is affected?'); assert.equal(pair.reference, 'kidney'); assert.equal(pair.candidate, 'renal');
        return scores(.65);
    }, { prompt: 'What organ is affected?' });
    assert.equal(result.status, 'uncertain');
    assert.equal((await grade('infarction', 'infarct', 'standard', () => { throw new Error('Offline'); })).reason, 'model-unavailable');
    assert.equal((await grade('infarction', 'infarct', 'standard', async () => ({ uncertainReason: 'too-long' }))).status, 'uncertain');
    assert.equal((await grade('infarction', 'infarct', 'standard', async () => scores(NaN))).status, 'uncertain');
});

test('manual correction changes study credit without training or reusing accepted answers', async () => {
    const d = prepareDeck({ title: 'Test', cards: [{ term: 'infarction', definition: 'Diagnosis' }] });
    const session = createSession(d, {}, { types: ['written'] });
    const judgement = await grade('infarction', 'infarct', 'standard', async () => scores(.6));
    const submitted = submitAnswer(session, d, 'infarct', 100, judgement);
    assert.equal(submitted.feedback.gradingStatus, 'uncertain'); assert.equal(submitted.feedback.correct, false);
    assert.equal(submitted.facts[session.current.key].wrong, 1);
    const corrected = overrideCorrect(submitted, 101);
    assert.equal(corrected.facts[session.current.key].wrong, 0); assert.equal(corrected.facts[session.current.key].correct, 1);
    assert.deepEqual(d.cards[0].termAliases, []);
    let calls = 0;
    assert.equal((await grade('infarction', 'infarct', 'standard', async () => { calls++; return scores(.6); })).status, 'uncertain');
    assert.equal(calls, 1);
});

test('every accepted written response differing from the displayed original requires confirmation', () => {
    const d = prepareDeck({ title: 'Confirmation', cards: [{ term: '**myocardial infarction**', definition: 'Diagnosis', termAliases: ['MI'] }] });
    const session = createSession(d, {}, { types: ['written'] });
    const exact = { status: 'correct', correct: true, reason: 'exact' };
    assert.equal(submitAnswer(session, d, 'myocardial infarction', 100, exact).feedback.requiresAcknowledgement, false);
    for (const response of ['Myocardial infarction', 'myocardial infarction!', 'myocardialinfarction', 'MI']) {
        const result = submitAnswer(session, d, response, 100, exact);
        assert.equal(result.feedback.requiresAcknowledgement, true);
        assert.equal(result.feedback.expected, '**myocardial infarction**');
        const wrong = overrideCorrect(result, 101, false);
        assert.equal(wrong.feedback.correct, false); assert.equal(wrong.feedback.requiresAcknowledgement, false);
        assert.equal(wrong.facts[session.current.key].correct, 0); assert.equal(wrong.facts[session.current.key].wrong, 1);
        assert.equal(overrideCorrect(wrong, 102).feedback.requiresAcknowledgement, true);
    }
});

test('NLI labels come from model config and logits are normalized stably', () => {
    const result = nliScores([1000, 999, 998], { 0: 'entailment', 1: 'neutral', 2: 'contradiction' });
    assert.ok(result.entailment > result.neutral && result.neutral > result.contradiction);
    assert.ok(Math.abs(Object.values(result).reduce((a, b) => a + b) - 1) < 1e-9);
    assert.throws(() => nliScores([1, 2, 3], {}));
});
