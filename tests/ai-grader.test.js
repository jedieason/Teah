import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGradingPrompt,
    parseGradeResponse,
    getScoreTier,
    gradeShortAnswer,
} from '../src/services/ai-grader.js';

test('buildGradingPrompt formats question, answers and student response', () => {
    const prompt = buildGradingPrompt({
        question: '解釋何為 CT? (問答題)',
        answer: ['cycle of threshold', '指數成長期'],
        explanation: 'Ct 全名為 cycle of threshold...',
        response: 'Ct 是 real-time PCR 達到螢光臨界值的循環數。',
    });
    assert.match(prompt, /【題目】：\n解釋何為 CT\? \(問答題\)/);
    assert.match(prompt, /cycle of threshold \/ 指數成長期/);
    assert.match(prompt, /【參考詳解】：\nCt 全名為 cycle of threshold/);
    assert.match(prompt, /【學生作答】：\nCt 是 real-time PCR 達到螢光臨界值的循環數。/);
});

test('parseGradeResponse correctly parses standard JSON', () => {
    const result = parseGradeResponse(JSON.stringify({
        score: 8,
        feedback: '作答核心觀念正確，但未提及初始模板量的反比關係。',
    }));
    assert.equal(result.score, 8);
    assert.equal(result.feedback, '作答核心觀念正確，但未提及初始模板量的反比關係。');
});

test('parseGradeResponse handles markdown code blocks and clamps score', () => {
    const md = '```json\n{\n  "score": 10,\n  "feedback": "敘述精準且完整。"\n}\n```';
    const result = parseGradeResponse(md);
    assert.equal(result.score, 10);
    assert.equal(result.feedback, '敘述精準且完整。');

    // Clamps to 10 max
    const high = parseGradeResponse('{"score": 15, "feedback": "爆表"}');
    assert.equal(high.score, 10);

    // Clamps to 0 min
    const low = parseGradeResponse('{"score": -3, "feedback": "負分"}');
    assert.equal(low.score, 0);

    // Rounds floating numbers
    const float = parseGradeResponse('{"score": 7.6, "feedback": "約 8 分"}');
    assert.equal(float.score, 8);
});

test('parseGradeResponse extracts JSON with noisy surrounding text', () => {
    const noisy = '以下是評分結果：\n{"score": 6, "feedback": "僅答對一半觀念。"}\n以上完畢。';
    const result = parseGradeResponse(noisy);
    assert.equal(result.score, 6);
    assert.equal(result.feedback, '僅答對一半觀念。');
});

test('parseGradeResponse throws on empty or invalid text', () => {
    assert.throws(() => parseGradeResponse(''), /評分回傳內容為空/);
    assert.throws(() => parseGradeResponse(null), /評分回傳內容為空/);
});

test('getScoreTier maps 0-10 scores to 4 color tiers and labels', () => {
    const t10 = getScoreTier(10);
    assert.equal(t10.tier, 'excellent');
    assert.equal(t10.label, '優秀');
    assert.equal(t10.className, 'score-tier-excellent');

    const t9 = getScoreTier(9);
    assert.equal(t9.tier, 'excellent');

    const t8 = getScoreTier(8);
    assert.equal(t8.tier, 'good');
    assert.equal(t8.label, '良好');
    assert.equal(t8.className, 'score-tier-good');

    const t7 = getScoreTier(7);
    assert.equal(t7.tier, 'good');

    const t6 = getScoreTier(6);
    assert.equal(t6.tier, 'fair');
    assert.equal(t6.label, '部分正確');
    assert.equal(t6.className, 'score-tier-fair');

    const t5 = getScoreTier(5);
    assert.equal(t5.tier, 'fair');

    const t4 = getScoreTier(4);
    assert.equal(t4.tier, 'poor');
    assert.equal(t4.label, '待加強');
    assert.equal(t4.className, 'score-tier-poor');

    const t0 = getScoreTier(0);
    assert.equal(t0.tier, 'poor');
});

test('gradeShortAnswer returns 0 for empty response without calling streamFn', async () => {
    let called = false;
    const result = await gradeShortAnswer({
        question: 'Q',
        answer: 'A',
        response: '   ',
        streamFn: async () => { called = true; return ''; },
    });
    assert.equal(called, false);
    assert.equal(result.score, 0);
    assert.equal(result.feedback, '未輸入作答內容。');
});

test('gradeShortAnswer invokes streamFn with schema config and parses result', async () => {
    let captured = null;
    const mockStream = async (args) => {
        captured = args;
        return JSON.stringify({ score: 9, feedback: '機制敘述清晰且完整。' });
    };

    const result = await gradeShortAnswer({
        question: '試述費城染色體之易位機制',
        answer: ['t(9;22)', 'BCR-ABL1'],
        explanation: 'BCR 與 ABL1 基因融合形成酪胺酸激酶過度活化',
        response: '第 9 與 22 號染色體易位產生 BCR-ABL 融合蛋白。',
        apiKey: 'fake-key',
        streamFn: mockStream,
    });

    assert.equal(result.score, 9);
    assert.equal(result.feedback, '機制敘述清晰且完整。');
    assert.equal(captured.config.responseMimeType, 'application/json');
    assert.match(captured.config.systemInstruction, /醫學考試閱卷評分助理/);
    assert.equal(captured.apiKey, 'fake-key');
});
