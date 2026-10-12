import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizImport, buildImportChanges } from '../src/shared/quiz-import.js';
import { buildMultiUnitPrompt } from '../src/shared/contribute-prompts.js';

const question = { question: '測試題目', options: { A: '甲', B: '乙' }, answer: 'B' };
const validName = title => !!title.trim() && !/[.#$\[\]/]/.test(title) && title !== 'quizCatalog';
const batch = count => ({ banks: Array.from({ length: count }, (_, i) => ({ title: `藥理學｜B${String(11 - i).padStart(2, '0')} 考古`, questions: [question] })) });

test('imports ten banks with titles and unchanged questions in one changes object', () => {
    const { banks, isBatch } = parseQuizImport(JSON.stringify(batch(10)));
    assert.equal(isBatch, true);
    banks[0].title = ' 藥理學｜抗生素 ';
    const changes = buildImportChanges(banks, validName);
    assert.equal(Object.keys(changes).length, 10);
    assert.deepEqual(changes['藥理學｜抗生素'], [question]);
    assert.deepEqual(changes['藥理學｜B09 考古'], [question]);
    assert.equal(changes['藥理學｜B9 考古'], undefined);
});

test('the generated prompt schema is accepted directly by the importer', () => {
    const text = buildMultiUnitPrompt('藥理學').match(/```json\n([\s\S]*?)\n```/)[0];
    const parsed = parseQuizImport(text);
    assert.equal(Object.keys(buildImportChanges(parsed.banks, validName)).length, 3);
    assert.deepEqual(parsed.banks[2].questions[0].answer, ['細胞壁']);
});

test('legacy single-bank arrays and code fences still accept a form or file title', () => {
    const parsed = parseQuizImport(`\n\`\`\`json\n${JSON.stringify([question])}\n\`\`\`\n`, '單一題庫');
    assert.equal(parsed.isBatch, false);
    assert.deepEqual(buildImportChanges(parsed.banks, validName), { 單一題庫: [question] });
});

test('invalid or incomplete batches fail entirely with bank/question context', () => {
    for (const text of ['{"banks":', 'null', '{}', '[]', '{"banks":[]}', '{"banks":{}}', '{"banks":[{}]}']) {
        assert.throws(() => parseQuizImport(text));
    }
    const value = batch(2);
    value.banks[1].questions[0] = { ...question, answer: 'C' };
    assert.throws(() => parseQuizImport(JSON.stringify(value)), /第 2 份題庫.*第 1 題/);
});

test('editable blank, duplicate, invalid and reserved titles cannot silently lose banks', () => {
    for (const title of ['', 'bad/name', 'quizCatalog', 'bad\u0001name']) {
        assert.throws(() => buildImportChanges([{ title, questions: [question] }], validName));
    }
    const parsed = parseQuizImport(JSON.stringify(batch(2)));
    parsed.banks[1].title = ` ${parsed.banks[0].title} `;
    assert.throws(() => buildImportChanges(parsed.banks, validName), /重複/);
    parsed.banks[1].title = '藥理學｜抗生素';
    assert.equal(Object.keys(buildImportChanges(parsed.banks, validName)).length, 2);
    assert.throws(() => buildImportChanges([], validName));
});
