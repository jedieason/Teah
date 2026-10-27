import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCategorizedPrompt, buildMultiUnitPrompt, buildSingleUnitPrompt, parseCustomUnits } from '../src/shared/contribute-prompts.js';

test('multi-bank prompt uses subject titles and one complete importable JSON block', () => {
    const prompt = buildMultiUnitPrompt('  藥理學  ');
    assert.ok(prompt.includes('<subject>藥理學</subject>'));
    assert.ok(prompt.includes('依原文件的分組模式'));
    assert.ok(prompt.includes('同一組題目只收錄一次'));
    assert.ok(prompt.includes('單元中的題目即使來自多個年份'));
    assert.ok(prompt.includes('即使有 10 份或更多'));
    assert.ok(prompt.includes('禁止輸出多個 Code Block'));
    assert.ok(prompt.includes('title 與 origin 都不可將 B09 改寫為 B9'));
    assert.ok(prompt.includes('依題本原文定義屆數'));
    const blocks = [...prompt.matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, 1);
    const value = JSON.parse(blocks[0][1]);
    assert.deepEqual(value.banks.map(bank => bank.title), ['藥理學｜B11 考古', '藥理學｜B10 考古', '藥理學｜抗生素']);
    assert.ok(value.banks.every(bank => Array.isArray(bank.questions) && bank.questions.length));
    assert.ok(prompt.includes('四大題型欄位規範'));
    assert.ok(prompt.includes('提供足以讓 Gemini 正確判讀作答對錯的標準答案或核心關鍵字即可'));
    assert.ok(!prompt.includes('每一年的 Code Block'));
    assert.ok(!prompt.includes('只能包含 Markdown 題庫標題'));
});

test('multi-bank prompt requires a subject and safely includes custom names', () => {
    assert.throws(() => buildMultiUnitPrompt(''), /科目名稱/);
    assert.throws(() => buildMultiUnitPrompt(' .#[$] / '), /科目名稱/);
    const prompt = buildMultiUnitPrompt(' 藥理.學#[$] / & <臨床> "進階" ');
    assert.ok(prompt.includes('<subject>藥理學  &amp; &lt;臨床&gt; "進階"</subject>'));
    const value = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)[1]);
    assert.equal(value.banks[0].title, '藥理學  & <臨床> "進階"｜B11 考古');
});

test('buildSingleUnitPrompt defaults to B12 考古 when empty', () => {
    const prompt = buildSingleUnitPrompt('');
    assert.ok(prompt.includes('【使用者指定任務】：本次僅製作【B12 考古】的題目。'));
    assert.ok(prompt.includes('【僅鎖定屬於「B12 考古」的題目與詳解進行擷取與轉換】'));
    assert.ok(prompt.includes('### 檢驗醫學區段一｜B12 考古'));
    assert.ok(prompt.includes('"origin": "出自 B12 考古 第 1 題"'));
    assert.ok(prompt.includes('嚴禁輸出其他單元'));
    assert.ok(prompt.includes('本次任務只需輸出【單一獨立的 JSON Array】'));
});

test('buildSingleUnitPrompt customizes with specified unit name and sanitizes illegal characters', () => {
    const prompt = buildSingleUnitPrompt('B13.期中#考[一]');
    // Illegal characters . # [ ] stripped
    assert.ok(prompt.includes('【使用者指定任務】：本次僅製作【B13期中考一】的題目。'));
    assert.ok(prompt.includes('### 檢驗醫學區段一｜B13期中考一'));
    assert.ok(prompt.includes('"origin": "出自 B13期中考一 第 1 題"'));
});

test('buildSingleUnitPrompt handles user requested B12 考古題 pattern', () => {
    const prompt = buildSingleUnitPrompt('  B12 考古題  ');
    assert.ok(prompt.includes('【使用者指定任務】：本次僅製作【B12 考古題】的題目。'));
    assert.ok(prompt.includes('【僅鎖定屬於「B12 考古題」的題目與詳解進行擷取與轉換】'));
    assert.ok(prompt.includes('### 檢驗醫學區段一｜B12 考古題'));
    assert.ok(prompt.includes('"origin": "出自 B12 考古題 第 1 題"'));
    assert.ok(prompt.includes('四大題型欄位規範'));
    assert.ok(prompt.includes('Gemini 註記機制'));
    assert.ok(prompt.includes('提供足以讓 Gemini 正確判讀作答對錯的標準答案或核心關鍵字即可'));
});

test('parseCustomUnits parses lines, strips prefixes, dedups and cleans illegal characters', () => {
    const rawInput = `
1. 自泌素
2. 抗生素、Steroid
3. NSAID、抗黴菌、抗病毒
4. 免疫療法
5. 寄生蟲
6. 抗腫瘤
1. 自泌素
7. [病理學]/單元#7$
- 一些特殊單元
* 另一個單元
一、中文編號單元
`;
    const units = parseCustomUnits(rawInput);
    assert.deepEqual(units, [
        '自泌素',
        '抗生素、Steroid',
        'NSAID、抗黴菌、抗病毒',
        '免疫療法',
        '寄生蟲',
        '抗腫瘤',
        '病理學單元7',
        '一些特殊單元',
        '另一個單元',
        '中文編號單元'
    ]);
});

test('buildCategorizedPrompt requires a subject and at least one unit', () => {
    assert.throws(() => buildCategorizedPrompt('', '自泌素\n抗生素'), /科目名稱/);
    assert.throws(() => buildCategorizedPrompt('  .# /  ', '自泌素'), /科目名稱/);
    assert.throws(() => buildCategorizedPrompt('病理學區段二', ''), /分類單元/);
    assert.throws(() => buildCategorizedPrompt('病理學區段二', '  \n  1.   \n  '), /分類單元/);
});

test('buildCategorizedPrompt formats XML, units list, zero-omission rules and sample schema', () => {
    const rawUnits = `
1. 自泌素
2. 抗生素、Steroid
3. NSAID、抗黴菌、抗病毒
4. 免疫療法
5. 寄生蟲
6. 抗腫瘤
`;
    const prompt = buildCategorizedPrompt('病理學區段二', rawUnits);
    assert.ok(prompt.includes('<subject>病理學區段二</subject>'));
    assert.ok(prompt.includes('本次整理的核心任務：【依指定單元分類映射】'));
    assert.ok(prompt.includes('<target_units>'));
    assert.ok(prompt.includes('1. 自泌素'));
    assert.ok(prompt.includes('2. 抗生素、Steroid'));
    assert.ok(prompt.includes('3. NSAID、抗黴菌、抗病毒'));
    assert.ok(prompt.includes('4. 免疫療法'));
    assert.ok(prompt.includes('5. 寄生蟲'));
    assert.ok(prompt.includes('6. 抗腫瘤'));
    assert.ok(prompt.includes('</target_units>'));
    assert.ok(prompt.includes('逐題映射與零遺漏'));
    assert.ok(prompt.includes('所有題目都必須映射至上述某一單元中，嚴禁遺漏任何一題'));
    assert.ok(prompt.includes('不要按原考卷年份建立題庫'));
    assert.ok(prompt.includes('請將各年份題目由新到舊排列（例如 B11、B10、B09... 依序往下整理）'));

    const blocks = [...prompt.matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, 1);
    const parsed = JSON.parse(blocks[0][1]);
    assert.equal(parsed.banks.length, 2);
    assert.equal(parsed.banks[0].title, '病理學區段二｜自泌素');
    assert.equal(parsed.banks[1].title, '病理學區段二｜抗生素、Steroid');
    assert.equal(parsed.banks[0].questions.length, 2);
    assert.ok(parsed.banks[0].questions[0].origin.includes('B11'));
    assert.ok(parsed.banks[0].questions[1].origin.includes('B10'));
});
