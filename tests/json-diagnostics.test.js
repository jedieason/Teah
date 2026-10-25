import test from 'node:test';
import assert from 'node:assert/strict';
import {
    stripMarkdownFences,
    scanJson,
    findTruncationAnchor,
    buildRepairPrompt,
    autoRepairJson,
    diagnoseJson,
    mergeContinuation
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
    assert.ok(diag.repairPrompt.startsWith('從 {'));
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
    assert.equal(diag.canAutoRepair, true);
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
