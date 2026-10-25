import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseJson, mergeContinuation } from '../src/shared/json-diagnostics.js';
import { parseQuizImport } from '../src/shared/quiz-import.js';
import { cutoffPrefix, cutoffQuestion, originalImport, originalBank, originalCutoff, repairResponse } from './fixtures/quiz-repair.js';
const merge = value => mergeContinuation(originalCutoff, JSON.stringify(value), parseQuizImport);

test('the supplied banks repair fits the cutoff despite title whitespace and preserves every preceding question', () => {
    const result = merge(repairResponse());
    assert.equal(result.success, true, result.error);
    assert.deepEqual(result.parsed, originalImport);
    assert.match(result.summary, /第 13 份題庫.*第 3 題.*前 12 份題庫.*前 2 題/);
});

test('repair prompt carries the exact bank, question, prefix and one independently valid output contract', () => {
    const prompt = diagnoseJson(originalCutoff).repairPrompt;
    for (const text of [JSON.stringify(originalBank.title), cutoffQuestion.origin, cutoffQuestion.question, cutoffPrefix,
        '第 13 份題庫', '第 3 題', '截斷欄位：explanation', '可獨立 JSON.parse', '包含 banks 陣列的物件', '不要重複前面已完成', '不要再附加']) {
        assert.ok(prompt.includes(text), text);
    }
    assert.ok(prompt.endsWith('"explanation": "' + cutoffPrefix));
    assert.ok(!prompt.includes('...'));
});

test('full-width punctuation, spaces and source formatting fit by the complete question without renaming the original bank', () => {
    const response = repairResponse();
    response.banks[0].title = '病理學區段二 | 鄭永銘老師—腫瘤學 (Neoplasm) (一)';
    const q = response.banks[0].questions[0];
    q.origin = '鄭永銘老師 ／ 腫瘤學(一) 第3題';
    q.question = q.question.replaceAll(' ', '  ');
    q.explanation = q.explanation.replaceAll('（', '(').replaceAll('）', ')');
    const result = merge(response);
    assert.equal(result.success, true, result.error);
    assert.equal(result.parsed.banks[12].title, originalBank.title);
    assert.equal(result.parsed.banks[12].questions[2].origin, cutoffQuestion.origin);
    assert.equal(result.parsed.banks[12].questions[2].question, cutoffQuestion.question);
    assert.ok(result.parsed.banks[12].questions[2].explanation.startsWith(cutoffPrefix));
    assert.deepEqual(result.parsed.banks.slice(0, 12), originalImport.banks.slice(0, 12));
    assert.deepEqual(result.parsed.banks[12].questions.slice(0, 2), originalBank.questions.slice(0, 2));
});

test('a rewritten bank title can fit only when the cutoff question matches uniquely', () => {
    const response = repairResponse();
    response.banks[0].title = '腫瘤學修補';
    assert.equal(merge(response).success, true);
    response.banks.push(structuredClone(response.banks[0]));
    response.banks[1].title = '另一份修補';
    const result = merge(response);
    assert.equal(result.success, false);
    assert.match(result.error, /多份題庫.*唯一定位/);
});

test('same-source answer/option/stem conflicts and a rewritten explanation prefix give specific failures', () => {
    for (const [field, change, expected] of [
        ['answer', 'A', /answer/], ['question', 'A different question?', /question/],
        ['explanation', '這是另一段詳解', /截斷文字/], ['options', { ...cutoffQuestion.options, A: 'Changed option' }, /options.A/]
    ]) {
        const response = repairResponse();
        response.banks[0].questions[0][field] = change;
        const result = merge(response);
        assert.equal(result.success, false, field);
        assert.match(result.error, expected);
        assert.match(result.error, /原始 JSON 已保留/);
    }
});

test('duplicate cutoff questions are rejected instead of picking the first or duplicating content', () => {
    const response = repairResponse();
    response.banks[0].questions.unshift(structuredClone(cutoffQuestion));
    const result = merge(response);
    assert.equal(result.success, false);
    assert.match(result.error, /多題.*唯一定位/);
});

test('old comma-separated question sequences use the same fitting and conflict checks', () => {
    const response = repairResponse();
    const sequence = () => JSON.stringify(response.banks[0].questions).slice(1, -1) + '\n]}]}';
    const fitted = mergeContinuation(originalCutoff, sequence(), parseQuizImport);
    assert.equal(fitted.success, true, fitted.error);
    assert.deepEqual(fitted.parsed, originalImport);
    response.banks[0].questions[0].answer = 'A';
    const conflict = mergeContinuation(originalCutoff, sequence(), parseQuizImport);
    assert.equal(conflict.success, false);
    assert.match(conflict.error, /answer/);
});

test('a repair that is cut off again reports its syntax error rather than pretending the missing text is complete', () => {
    const text = JSON.stringify(repairResponse());
    const result = mergeContinuation(originalCutoff, text.slice(0, text.indexOf(cutoffPrefix) + 10), parseQuizImport);
    assert.equal(result.success, false);
    assert.match(result.error, /修補檔尚未完成.*第/);
});

test('punctuation repair cannot bypass the cutoff question identity checks', () => {
    const response = repairResponse();
    const tail = () => JSON.stringify(response.banks[0].questions[0]).slice(0, -1) + ',}';
    const valid = mergeContinuation(originalCutoff, tail(), parseQuizImport);
    assert.equal(valid.success, true, valid.error);
    response.banks[0].questions[0].answer = 'A';
    const conflict = mergeContinuation(originalCutoff, tail(), parseQuizImport);
    assert.equal(conflict.success, false);
    assert.match(conflict.error, /answer/);
});
