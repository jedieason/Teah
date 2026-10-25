import test from 'node:test';
import assert from 'node:assert/strict';
import {
    stripMarkdownFences,
    scanJson,
    findTruncationAnchor,
    buildRepairPrompt,
    autoRepairJson,
    diagnoseJson,
    mergeContinuation,
    locateJsonPath,
    locateJsonError,
    buildJsonRepairPrompt
} from '../src/shared/json-diagnostics.js';
import { parseQuizImport } from '../src/shared/quiz-import.js';

const truncatedMultiBank = `{
  "banks": [
    {
      "title": "病理學區段二｜B11 考古",
      "questions": [
        {
          "origin": "出自 B11 考古第 1 題",
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP",
            "C": "RNA",
            "D": "NADH"
          },
          "answer": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    },
    {
      "title": "病理學區段二｜B10 考古",
      "questions": [
        {
          "origin": "出自 B10 考古第 1 題",
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP",
            "C": "RNA",
            "D": "NADH"
          },
          "answ`;

test('stripMarkdownFences removes various markdown fences', () => {
    assert.equal(stripMarkdownFences('```json\n{"a": 1}\n```'), '{"a": 1}');
    assert.equal(stripMarkdownFences("'''json\n{\"a\": 1}\n'''"), '{"a": 1}');
    assert.equal(stripMarkdownFences('```\n{"a": 1}\n```'), '{"a": 1}');
    assert.equal(stripMarkdownFences('```json\n{"a": 1}'), '{"a": 1}');
    assert.equal(stripMarkdownFences('{"a": 1}\n```'), '{"a": 1}');
});

test('diagnoses truncated multi-bank JSON and produces expected repair prompt anchor', () => {
    const diag = diagnoseJson(truncatedMultiBank);
    assert.equal(diag.isValid, false);
    assert.equal(diag.isTruncated, true);
    assert.ok(diag.truncationAnchor);
    assert.ok(diag.truncationAnchor.snippet.startsWith('{'));
    assert.ok(diag.truncationAnchor.snippet.includes('"origin": "出自 B10 考古第 1 題"'));
    assert.ok(diag.truncationAnchor.snippet.endsWith('"answ'));

    // Verify repair prompt format: 從 { ... "answ 接續
    assert.ok(diag.repairPrompt.includes('從 {'));
    assert.ok(diag.repairPrompt.endsWith('"answ 接續'));
});

test('diagnoses truncated single-chapter question array', () => {
    const singleTruncated = `[
      {
        "origin": "第 1 題",
        "question": "第一題",
        "options": { "A": "甲", "B": "乙" },
        "answer": "A"
      },
      {
        "origin": "第 2 題",
        "question": "第二題",
        "options": { "A": "甲", "B": "乙" },
        "answ`;

    const diag = diagnoseJson(singleTruncated);
    assert.equal(diag.isTruncated, true);
    assert.ok(diag.repairPrompt.includes('出自 第 2 題') || diag.repairPrompt.includes('"origin": "第 2 題"'));
    assert.ok(diag.repairPrompt.endsWith('"answ 接續'));
});

test('mergeContinuation merges direct splice seamlessly', () => {
    const continuation = `er": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    }
  ]
}`;
    const result = mergeContinuation(truncatedMultiBank, continuation);
    assert.equal(result.success, true);
    const parsed = parseQuizImport(result.mergedText);
    assert.equal(parsed.isBatch, true);
    assert.equal(parsed.banks.length, 2);
    assert.equal(parsed.banks[1].questions[0].answer, 'B');
});

test('mergeContinuation merges when AI repeats the cut-off key', () => {
    const continuation = `"answer": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    }
  ]
}`;
    const result = mergeContinuation(truncatedMultiBank, continuation);
    assert.equal(result.success, true);
    const parsed = parseQuizImport(result.mergedText);
    assert.equal(parsed.banks.length, 2);
    assert.equal(parsed.banks[1].questions[0].answer, 'B');
});

test('mergeContinuation merges when AI repeats the entire cut-off question', () => {
    const continuation = `{
          "origin": "出自 B10 考古第 1 題",
          "question": "下列何者是細胞主要的能量載體？",
          "options": {
            "A": "DNA",
            "B": "ATP",
            "C": "RNA",
            "D": "NADH"
          },
          "answer": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    }
  ]
}`;
    const result = mergeContinuation(truncatedMultiBank, continuation);
    assert.equal(result.success, true);
    const parsed = parseQuizImport(result.mergedText);
    assert.equal(parsed.banks.length, 2);
    assert.equal(parsed.banks[1].questions[0].answer, 'B');
});

test('mergeContinuation handles markdown wrapped continuation with echo', () => {
    const continuation = `從
{
  "origin": "出自 B10 考古第 1 題",
  "answ
接續

\`\`\`json
er": "B",
          "explanation": "ATP 是細胞主要的能量載體。"
        }
      ]
    }
  ]
}
\`\`\``;
    const result = mergeContinuation(truncatedMultiBank, continuation);
    assert.equal(result.success, true);
    const parsed = parseQuizImport(result.mergedText);
    assert.equal(parsed.banks.length, 2);
    assert.equal(parsed.banks[1].questions[0].answer, 'B');
});

test('autoRepairJson fixes markdown code blocks like \'\'\'json', () => {
    const textWithTripleQuotes = `'''json
{
  "banks": [
    {
      "title": "藥理學｜測試",
      "questions": [
        {
          "question": "測試題目",
          "options": { "A": "甲", "B": "乙" },
          "answer": "A"
        }
      ]
    }
  ]
}
'''`;
    const diag = diagnoseJson(textWithTripleQuotes);
    assert.equal(diag.isValid, true);
    assert.equal(diag.canAutoRepair, false);
    assert.ok(diag.hasMarkdownFences);
    const repaired = autoRepairJson(textWithTripleQuotes);
    const parsed = parseQuizImport(repaired);
    assert.equal(parsed.banks.length, 1);
});

test('autoRepairJson fixes missing comma between properties', () => {
    const missingComma = `{
  "banks": [
    {
      "title": "藥理學｜測試",
      "questions": [
        {
          "question": "測試題目",
          "options": { "A": "甲", "B": "乙" }
          "answer": "A"
        }
      ]
    }
  ]
}`;
    const diag = diagnoseJson(missingComma);
    assert.equal(diag.isValid, false);
    assert.equal(diag.canAutoRepair, true);
    assert.ok(diag.snippet.includes('^'));
    const repaired = autoRepairJson(missingComma);
    const parsed = parseQuizImport(repaired);
    assert.equal(parsed.banks[0].questions[0].answer, 'A');
});

test('autoRepairJson fixes trailing comma before closing brace', () => {
    const trailingComma = `{
  "banks": [
    {
      "title": "藥理學｜測試",
      "questions": [
        {
          "question": "測試題目",
          "options": { "A": "甲", "B": "乙", },
          "answer": "A",
        },
      ],
    },
  ],
}`;
    const diag = diagnoseJson(trailingComma);
    assert.equal(diag.canAutoRepair, true);
    const repaired = autoRepairJson(trailingComma);
    const parsed = parseQuizImport(repaired);
    assert.equal(parsed.banks[0].questions[0].answer, 'A');
});


test('schema errors locate the exact bank/question even with repeated content and fences', () => {
    const q = { question: '重複題目 \"引號\"', answer: 'A' };
    const banks = Array.from({ length: 13 }, (_, i) => ({ title: `題庫 ${i + 1}`, questions: [{ ...q }, { ...q }, { ...q }] }));
    delete banks[12].questions[2].question;
    const text = '  \n```json\n' + JSON.stringify({ banks }, null, 2) + '\n```\n';
    let error;
    try { parseQuizImport(text); } catch (err) { error = err; }
    assert.deepEqual(error.path, ['banks', 12, 'questions', 2, 'question']);
    const location = locateJsonPath(text, error.path);
    assert.equal(text[location.position], '{');
    assert.ok(text.slice(location.position).startsWith('{\n          "answer": "A"'));
    assert.equal(location.line, text.slice(0, location.position).split('\n').length);
    const prompt = buildJsonRepairPrompt(text, error.message, location, error.path);
    assert.ok(prompt.includes('$.banks[12].questions[2].question'));
    assert.ok(prompt.includes(error.message));
    assert.ok(prompt.endsWith(text));
});

test('locates existing invalid fields, null questions and empty roots', () => {
    for (const value of [[{ question: '', answer: 'A' }], [null], []]) {
        const text = JSON.stringify(value);
        let error;
        try { parseQuizImport(text); } catch (err) { error = err; }
        const location = locateJsonPath(text, error.path);
        const marked = text.slice(location.position, location.end);
        assert.equal(marked, !value.length ? '[' : value[0] === null ? 'null' : '\"\"');
    }
});

test('syntax locations preserve leading whitespace, Unicode and line/column positions', () => {
    const text = '\n  [\n {"question":"中文 🧬", "answer":}\n]';
    const diag = diagnoseJson(text);
    assert.equal(text[diag.location.position], '}');
    assert.equal(diag.hasMarkdownFences, false);
    const location = locateJsonError('a\nbc', { message: 'error (line 2 column 2)' });
    assert.deepEqual(location, { line: 2, col: 2, position: 3 });
});

test('punctuation repair preserves all string payloads', () => {
    const q = { question: '保留 ,} 、 }{ 與 ,] 及 \"引號\"', answer: 'A', explanation: 'line 1\nline 2' };
    const valid = JSON.stringify([q]);
    assert.equal(autoRepairJson(valid), valid);
    const invalid = valid.replace(/}\]$/, '},]');
    assert.deepEqual(JSON.parse(autoRepairJson(invalid)), [q]);
});

test('Markdown wrappers are ignored for parsing, diagnostics and real error positions', () => {
    const q = { question: "題目保留 '''json 與 ```json", answer: 'A' };
    for (const opening of ['```json', "'''json", '```JSON', "'''"]) {
        const closing = opening.slice(0, 3);
        const text = opening + '\n' + JSON.stringify([q]) + '\n' + closing;
        assert.deepEqual(parseQuizImport(text).banks[0].questions, [q]);
        assert.equal(diagnoseJson(text).isValid, true);
        const incomplete = opening + '\n[{"question":"測試", "answer":"A", "explanation":"卵巢癌';
        const diag = diagnoseJson(incomplete);
        assert.equal(diag.isTruncated, true);
        assert.match(diag.message, /中途中斷截斷/);
        assert.doesNotMatch(diag.message, /Markdown/);
        assert.equal(diag.location.position, incomplete.length);
        const bad = opening + '\n[{"question":"測試", "answer":}]\n' + closing;
        assert.equal(bad[diagnoseJson(bad).location.position], '}');
    }
});

const repeatQuestion = n => ({ origin: `來源 第 ${n} 題`, question: '相同題幹', options: { A: '甲', B: '乙' }, answer: 'A', explanation: `第 ${n} 題完整詳解` });
const previousBanks = Array.from({ length: 12 }, (_, i) => ({ title: `已完成題庫 ${i + 1}`, questions: [repeatQuestion(100 + i)] }));
const currentBank = { title: '病理學區段二｜腫瘤學（一）', questions: [repeatQuestion(1), repeatQuestion(2), repeatQuestion(3), repeatQuestion(4)] };
const allBanks = { banks: [...previousBanks, currentBank] };
const fullSource = JSON.stringify(allBanks, null, 2);
const cutSource = fullSource.slice(0, fullSource.indexOf('第 3 題完整詳解') + 5);

test('bank-level continuation repairs the screenshot case without losing earlier banks/questions', () => {
    const responses = [
        JSON.stringify({ ...currentBank, questions: currentBank.questions.slice(2) }),
        JSON.stringify({ ...currentBank, questions: currentBank.questions.slice(2) }) + '\n]\n}',
        JSON.stringify(currentBank),
        JSON.stringify([currentBank]),
        JSON.stringify({ banks: [currentBank] }),
        JSON.stringify(allBanks),
        JSON.stringify(currentBank.questions.slice(2)),
    ];
    for (const response of responses) {
        const result = mergeContinuation("'''json\n" + cutSource, "'''json\n" + response + "\n'''", parseQuizImport);
        assert.equal(result.success, true, response);
        assert.deepEqual(JSON.parse(result.mergedText), allBanks);
    }
});

test('a repeated question or bank replaces the unfinished question even if its last field has not started', () => {
    const text = fullSource.slice(0, fullSource.indexOf('"explanation": "第 3 題完整詳解"'));
    for (const response of [JSON.stringify({ ...currentBank, questions: currentBank.questions.slice(2) }),
        JSON.stringify(currentBank.questions.slice(2)).slice(1, -1) + '] } ] }']) {
        const result = mergeContinuation(text, response, parseQuizImport);
        assert.equal(result.success, true);
        assert.deepEqual(JSON.parse(result.mergedText), allBanks);
    }
});

test('continuation between questions retains the complete prefix and avoids duplicate repeats', () => {
    const q = [repeatQuestion(1), repeatQuestion(2), repeatQuestion(3)];
    const base = JSON.stringify(q.slice(0, 2)).slice(0, -1) + ',';
    for (const response of [JSON.stringify([q[2]]), JSON.stringify(q)]) {
        const result = mergeContinuation(base, response, parseQuizImport);
        assert.equal(result.success, true);
        assert.deepEqual(JSON.parse(result.mergedText), q);
    }
});

test('unrelated bank or still-truncated repair is rejected instead of closing missing content', () => {
    for (const response of [JSON.stringify({ title: '無關題庫', questions: [repeatQuestion(9)] }),
        JSON.stringify({ title: currentBank.title, questions: [repeatQuestion(4)] }), JSON.stringify(repeatQuestion(4)), '[]',
        '{"origin":"來源 第 3 題","question":"相同題幹","answer":"A","explanation":"未完成']) {
        assert.equal(mergeContinuation(cutSource, response, parseQuizImport).success, false);
    }
});
