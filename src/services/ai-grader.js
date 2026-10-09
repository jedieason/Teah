import { streamGemini } from './gemini-stream.js';

export const GRADING_SYSTEM_INSTRUCTION = `你是嚴謹、客觀且專業的醫學考試閱卷評分助理。
請依據題目、標準答案 / 關鍵字與參考詳解，針對學生的簡答作答內容進行評分（滿分為 10 分）。

【評分標準（0 - 10 分）】：
- 9 - 10 分：核心概念與醫學機制完全正確，論述完整且精確。
- 7 - 8 分：大致正確，包含主要核心要點，僅有次要細節遺漏或輕微語病。
- 5 - 6 分：部分正確，點出部分關鍵概念或方向正確，但核心要點不夠完整或有輕度瑕疵。
- 3 - 4 分：僅觸及少量邊緣概念，但有明顯觀念混淆或遺漏大部分核心關鍵。
- 0 - 2 分：完全錯誤、答非所問、空白或無任何實質醫學知識相關回答。

【輸出規範】：
必須輸出合法的純 JSON 格式，嚴禁任何多餘的引言、Markdown 外框或雜訊：
{
  "score": 8,
  "feedback": "作答準確點出...，但缺少...。"
}

其中：
- score: 0 到 10 之間的整數。
- feedback: 繁體中文，2 到 3 句話簡短說明評分原因，明確指出答對重點與缺失不足之處。只保留客觀評析，不使用客套話、重複引導或勵志標語。`;

export function buildGradingPrompt({ question, answer, explanation, response }) {
    const formattedAnswer = Array.isArray(answer) ? answer.join(' / ') : (answer || '');
    return `【題目】：
${question || ''}

【標準答案 / 關鍵字】：
${formattedAnswer}
${explanation ? `\n【參考詳解】：\n${explanation}\n` : ''}
【學生作答】：
${response || '(空白未作答)'}`;
}

export function parseGradeResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        throw new Error('評分回傳內容為空');
    }

    let cleaned = rawText.trim();
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim();
    }

    let parsed = null;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const objMatch = cleaned.match(/\{[\s\S]*?\}/);
        if (objMatch) {
            try {
                parsed = JSON.parse(objMatch[0]);
            } catch {
                // Ignore and fall through to regex extraction
            }
        }
    }

    let score = NaN;
    let feedback = '';

    if (parsed && typeof parsed === 'object') {
        score = Number(parsed.score);
        if (typeof parsed.feedback === 'string') {
            feedback = parsed.feedback.trim();
        }
    }

    if (!Number.isFinite(score)) {
        const scoreMatch = rawText.match(/"score"\s*:\s*(\d+)/i) || rawText.match(/score\s*[:=]\s*(\d+)/i);
        if (scoreMatch) {
            score = Number(scoreMatch[1]);
        } else {
            score = 0;
        }
    }

    if (!feedback) {
        const feedbackMatch = rawText.match(/"feedback"\s*:\s*"([^"]+)"/i);
        if (feedbackMatch) {
            feedback = feedbackMatch[1].trim();
        } else {
            feedback = '評分完成。';
        }
    }

    score = Math.max(0, Math.min(10, Math.round(score)));

    return { score, feedback };
}

export function getScoreTier(score) {
    const s = Number(score);
    if (s >= 9) {
        return {
            tier: 'excellent',
            label: '優秀',
            className: 'score-tier-excellent',
            color: '#18ae79',
            badgeBg: '#e6f7f0',
        };
    }
    if (s >= 7) {
        return {
            tier: 'good',
            label: '良好',
            className: 'score-tier-good',
            color: '#0b57d0',
            badgeBg: '#e8f0fe',
        };
    }
    if (s >= 5) {
        return {
            tier: 'fair',
            label: '部分正確',
            className: 'score-tier-fair',
            color: '#d97706',
            badgeBg: '#fef3c7',
        };
    }
    return {
        tier: 'poor',
        label: '待加強',
        className: 'score-tier-poor',
        color: '#d93025',
        badgeBg: '#fce8e6',
    };
}

export async function gradeShortAnswer({
    question,
    answer,
    explanation,
    response,
    apiKey,
    signal,
    endpoint = '/api/chat',
    streamFn = streamGemini,
}) {
    const trimmed = (response || '').trim();
    if (!trimmed) {
        return {
            score: 0,
            feedback: '未輸入作答內容。',
        };
    }

    const contents = [
        {
            role: 'user',
            parts: [{ text: buildGradingPrompt({ question, answer, explanation, response: trimmed }) }],
        },
    ];

    const config = {
        systemInstruction: GRADING_SYSTEM_INSTRUCTION,
        temperature: 0.2,
        responseMimeType: 'application/json',
    };

    const rawText = await streamFn({
        contents,
        config,
        model: 'gemini-2.5-flash-lite',
        apiKey,
        signal,
        endpoint,
    });

    return parseGradeResponse(rawText);
}
