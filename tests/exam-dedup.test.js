import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    parseQuizYear,
    findSubsequentQuizzes,
    normalizeText,
    diceSimilarity,
    areQuestionsDuplicate,
    filterNonRepeatedQuestions,
    getPastExamComparisonInfo
} from '../src/services/exam-dedup.js';

test('parseQuizYear extracts cohort, year number, and subtype accurately', () => {
    assert.deepEqual(parseQuizYear('檢驗醫學區段一｜B08 考古'), {
        subject: '檢驗醫學區段一',
        title: 'B08 考古',
        yearNum: 8,
        yearStr: 'B08',
        subType: '考古'
    });

    assert.deepEqual(parseQuizYear('_Archive_解剖學｜B08 期中'), {
        subject: '解剖學',
        title: 'B08 期中',
        yearNum: 8,
        yearStr: 'B08',
        subType: '期中'
    });

    assert.deepEqual(parseQuizYear('_Archive_神經解剖學｜B10 期中考'), {
        subject: '神經解剖學',
        title: 'B10 期中考',
        yearNum: 10,
        yearStr: 'B10',
        subType: '期中考'
    });

    assert.deepEqual(parseQuizYear('_Archive_生理學實驗｜B09'), {
        subject: '生理學實驗',
        title: 'B09',
        yearNum: 9,
        yearStr: 'B09',
        subType: ''
    });

    assert.equal(parseQuizYear('檢驗醫學區段一｜分子檢驗學'), null);
});

test('findSubsequentQuizzes finds subsequent cohorts matching subject and subtype', () => {
    const allCatalogKeys = [
        '檢驗醫學區段一｜B04 考古',
        '檢驗醫學區段一｜B05 考古',
        '檢驗醫學區段一｜B06 考古',
        '檢驗醫學區段一｜B07 考古',
        '檢驗醫學區段一｜B08 考古',
        '檢驗醫學區段一｜B09 考古',
        '檢驗醫學區段一｜B10 考古',
        '檢驗醫學區段一｜分子檢驗學',
        '_Archive_解剖學｜B08 期中',
        '_Archive_解剖學｜B08 期末',
        '_Archive_解剖學｜B09 期中',
        '_Archive_解剖學｜B09 期末',
        '_Archive_解剖學｜B10 期中',
        '_Archive_解剖學｜B10 期末',
        '_Archive_解剖學｜B11 期中',
        '_Archive_解剖學｜B11 期末'
    ];

    const laterB08 = findSubsequentQuizzes('檢驗醫學區段一｜B08 考古', allCatalogKeys);
    assert.deepEqual(laterB08, [
        '檢驗醫學區段一｜B09 考古',
        '檢驗醫學區段一｜B10 考古'
    ]);

    const laterB08Mid = findSubsequentQuizzes('_Archive_解剖學｜B08 期中', allCatalogKeys);
    assert.deepEqual(laterB08Mid, [
        '_Archive_解剖學｜B09 期中',
        '_Archive_解剖學｜B10 期中',
        '_Archive_解剖學｜B11 期中'
    ]);

    // B10 is the newest in 檢驗醫學 -> returns empty
    const laterB10 = findSubsequentQuizzes('檢驗醫學區段一｜B10 考古', allCatalogKeys);
    assert.deepEqual(laterB10, []);
});

test('normalizeText handles whitespace, punctuation, LaTeX symbols and case', () => {
    assert.equal(normalizeText('The $R_1$ and $R_2$ residues, of three!'), 'ther1andr2residuesofthree');
    assert.equal(normalizeText('下列何者是現行常見的 TDM？'), '下列何者是現行常見的tdm');
    assert.equal(normalizeText('病患初始血鉀濃度為 6 mmol/L。'), '病患初始血鉀濃度為6mmol/l');
});

test('areQuestionsDuplicate prevents false positives on generic stems with different options', () => {
    const q1 = {
        question: '下列敘述何者正確？',
        options: { A: '心臟衰竭引起濾出液', B: '胰臟炎引起濾出液', C: '惡性腫瘤引起濾出液' }
    };
    const q2 = {
        question: '下列何者正確？',
        options: { A: '盤尼西林抑制細胞壁', B: '紅黴素抑制DNA', C: '四環黴素抑制核糖體50S' }
    };
    assert.equal(areQuestionsDuplicate(q1, q2), false);
});

test('areQuestionsDuplicate detects duplicates despite punctuation and minor rephrasing', () => {
    const q1 = {
        question: '病患初始血鉀濃度為 6 mmol/L。經治療 6 小時後再追蹤，已知檢驗系統性誤差為 0 mmol/L，隨機誤差為 0.06 mmol/L。追蹤結果如下：\n(1) 6.1 mM\n(2) 6.5 mM\n(3) 5.0 mM\n(4) 5.3 mM\n(5) 5.9 mM\n請問上述結果哪些代表測量值有顯著的變化？',
        options: { A: '123', B: '145', C: '234', D: '245', E: '345' }
    };
    const q2 = {
        question: '患者血鉀濃度為 6 mmol/L，有高血鉀的情況。醫師給予初步治療後於 6 小時再次追蹤。已知血鉀檢驗的系統性誤差為 0 mmol/L，隨機誤差為 0.06 mmol/L，再次檢驗結果如下：\n(1) 6.1 mM\n(2) 6.5 mM\n(3) 5.0 mM\n(4) 5.3 mM\n(5) 5.9 mM\n請問上述結果哪些代表測量值有顯著的變化？',
        options: { A: '123', B: '145', C: '234', D: '245', E: '345' }
    };
    assert.equal(areQuestionsDuplicate(q1, q2), true);
});

test('檢驗醫學題庫測試: B08 compared against B09 and B10 correctly identifies repeated questions', async () => {
    const qbDir = path.resolve('QuestionBank');
    const readLocal = (file) => JSON.parse(fs.readFileSync(path.join(qbDir, file), 'utf8'));

    const b08 = readLocal('檢驗醫學區段一｜B08 考古.json');
    const b09 = readLocal('檢驗醫學區段一｜B09 考古.json');
    const b10 = readLocal('檢驗醫學區段一｜B10 考古.json');

    assert.equal(b08.length, 12);
    assert.equal(b09.length, 19);
    assert.equal(b10.length, 22);

    const laterBanks = [
        { key: '檢驗醫學區段一｜B09 考古', questions: b09 },
        { key: '檢驗醫學區段一｜B10 考古', questions: b10 }
    ];

    const { nonRepeated, repeated, duplicates } = filterNonRepeatedQuestions(b08, laterBanks);

    // 10 questions in B08 repeat in B09 / B10
    // 2 questions (Q2: 造成濾出液的病變, Q7: POCT 痰液) are unique non-repeated questions
    assert.equal(repeated.length, 10);
    assert.equal(nonRepeated.length, 2);

    // Verify non-repeated questions are Q2 and Q7
    assert.match(nonRepeated[0].question, /濾出液/);
    assert.match(nonRepeated[1].question, /下列何項檢體不是重點照護檢測 POCT 所用/);

    // Test getPastExamComparisonInfo helper
    const catalogKeys = [
        '檢驗醫學區段一｜B07 考古',
        '檢驗醫學區段一｜B08 考古',
        '檢驗醫學區段一｜B09 考古',
        '檢驗醫學區段一｜B10 考古'
    ];
    const mockReadBank = async (k) => readLocal(`${k}.json`);

    const result = await getPastExamComparisonInfo('檢驗醫學區段一｜B08 考古', catalogKeys, mockReadBank);
    assert.equal(result.hasLaterExams, true);
    assert.equal(result.rangeStr, 'B08 - B10');
    assert.equal(result.totalCount, 12);
    assert.equal(result.nonRepeatedCount, 2);
    assert.equal(result.repeatedCount, 10);
    assert.equal(result.laterKeys.length, 2);
});
