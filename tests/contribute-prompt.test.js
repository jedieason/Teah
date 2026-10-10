import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRIBUTE_FULL_PROMPT, buildSingleUnitPrompt } from '../src/shared/contribute-prompts.js';

test('CONTRIBUTE_FULL_PROMPT contains multi-year instructions and markdown headers', () => {
    assert.ok(CONTRIBUTE_FULL_PROMPT.includes('<role>'));
    assert.ok(CONTRIBUTE_FULL_PROMPT.includes('【每一屆數/年份必須獨立成一個獨立的 JSON Array】'));
    assert.ok(CONTRIBUTE_FULL_PROMPT.includes('### 檢驗醫學區段一｜B11 考古'));
    assert.ok(CONTRIBUTE_FULL_PROMPT.includes('### 檢驗醫學區段一｜B10 考古'));
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
    assert.ok(prompt.includes('題矣註記機制'));
});
