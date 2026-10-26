import { canonicalQuestion } from '../features/mistakes/model.js';

export function resolveQuizTitle({ selectedJson = '', isMistakePracticeMode = false, sessionKind = 'bank', defaultTitle = '測驗' } = {}) {
    if (isMistakePracticeMode) return '錯題複習';
    if (sessionKind === 'custom') return '自訂測驗';
    const clean = (selectedJson || '').split('/').pop().replace(/^_Archive_/, '').replace(/\.json$/, '').trim();
    return clean || defaultTitle;
}

export function sanitizeFilename(name = '', fallback = '答題紀錄') {
    const clean = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_');
    return clean || fallback;
}

function sortOptionKeys(a, b) {
    if (a === 'T' && b === 'F') return -1;
    if (a === 'F' && b === 'T') return 1;
    return a.localeCompare(b, 'zh-Hant');
}

function resolveOptionText(options, answer) {
    if (!options || answer == null) return null;
    if (Array.isArray(answer)) {
        return answer.map(key => options[key] !== undefined ? options[key] : key);
    }
    return options[answer] !== undefined ? options[answer] : answer;
}

export function buildQuizRecord(allQuestions = [], options = {}) {
    const title = options.title || resolveQuizTitle(options);
    const completedAt = options.completedAt || new Date().toISOString();

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const questions = (allQuestions || []).map((q, idx) => {
        const canonical = canonicalQuestion(q);
        const isAnswered = Boolean(q.isAnswered);
        const isCorrect = Boolean(q.isCorrect);

        if (!isAnswered) {
            unansweredCount++;
        } else if (isCorrect) {
            correctCount++;
        } else {
            wrongCount++;
        }

        const result = !isAnswered ? '未作答' : (isCorrect ? '答對' : '答錯');

        const sortedOptions = canonical.options
            ? Object.fromEntries(Object.entries(canonical.options).sort(([a], [b]) => sortOptionKeys(a, b)))
            : null;

        const userAnswer = isAnswered ? canonical.lastSelection : null;
        const correctAnswer = canonical.answer;

        const recordItem = {
            index: idx + 1,
            question: canonical.question,
            options: sortedOptions,
            isCorrect,
            result,
            userAnswer,
            correctAnswer,
            userAnswerText: resolveOptionText(sortedOptions, userAnswer),
            correctAnswerText: resolveOptionText(sortedOptions, correctAnswer)
        };

        if (canonical.explanation) {
            recordItem.explanation = canonical.explanation;
        }
        if (canonical.origin) {
            recordItem.origin = canonical.origin;
        }

        return recordItem;
    });

    const totalQuestions = (allQuestions || []).length;
    const answeredCount = correctCount + wrongCount;
    const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

    return {
        title,
        completedAt,
        summary: {
            totalQuestions,
            answeredCount,
            unansweredCount,
            correctCount,
            wrongCount,
            accuracy: `${accuracy}%`
        },
        questions
    };
}

export function downloadQuizRecord(record, customFilename) {
    const filename = customFilename || `${sanitizeFilename(record?.title)}.json`;
    const jsonString = JSON.stringify(record, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
