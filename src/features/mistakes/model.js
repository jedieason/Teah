// Pure helpers shared by the notebook, practice sessions and persistence.
export function quizLabel(key = '') {
    const clean = key.replace(/^_Archive_/, '').replace(/\.json$/, '');
    const parts = clean.split(/[｜|]/);
    return { subject: parts.length > 1 ? parts.shift() : '其他', title: parts.join('｜') };
}

export function flattenMistakes(cache = {}) {
    const result = [];
    for (const [quizKey, data] of Object.entries(cache)) {
        const walk = (value, path) => {
            if (!value || typeof value !== 'object') return;
            if (typeof value.question === 'string') {
                result.push({ ...value, quizKey, recordPath: path, id: `${quizKey}/${path}`, ...quizLabel(quizKey) });
                return;
            }
            for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}/${key}` : key);
        };
        walk(data, '');
    }
    return result;
}

export function filterMistakes(items, { query = '', subject = '', quiz = '', status = 'active', sort = 'recent' } = {}) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(m => (!subject || m.subject === subject) && (!quiz || m.quizKey === quiz)
        && (status === 'all' || (status === 'mastered' ? m.status === 'mastered' : m.status !== 'mastered'))
        && words.every(word => [m.question, m.title, m.subject, m.origin, ...Object.values(m.options || {})]
            .join(' ').toLocaleLowerCase().includes(word)))
        .sort((a, b) => {
            const difference = sort === 'frequent' ? (b.count || 0) - (a.count || 0)
                : sort === 'oldest' ? (a.lastReviewed || a.lastMistake || 0) - (b.lastReviewed || b.lastMistake || 0)
                : (b.lastMistake || 0) - (a.lastMistake || 0);
            return difference || a.id.localeCompare(b.id, 'zh-Hant');
        });
}

export function canonicalQuestion(question) {
    const mapping = question.reverseLabelMapping || {};
    const mapAnswer = value => Array.isArray(value) ? value.map(v => mapping[v] || v) : mapping[value] || value;
    const options = question.options ? Object.fromEntries(Object.entries(question.options).map(([k, v]) => [mapping[k] || k, v])) : null;
    const explanation = typeof question.explanation === 'string' ? question.explanation.replace(/[（(]\s*([A-L])\s*[）)]/g,
        (match, letter) => mapping[letter] ? `(${mapping[letter]})` : match) : '';
    return {
        questionId: question.questionId || null, revision: question.revision || 1, taxonomy: question.taxonomy || null,
        question: question.question, options, answer: question.options ? mapAnswer(question.answer) : question.answer,
        explanation, origin: question.origin || null,
        originalIndex: Number.isInteger(question.originalIndex) ? question.originalIndex : -1,
        isFillBlank: !options, isMultiSelect: !!options && Array.isArray(question.answer) && question.answer.length > 1,
        lastSelection: question.options ? mapAnswer(question.userSelection) || null : question.userSelection || null,
        reverseLabelMapping: null
    };
}

export function applyAttempt(previous, snapshot, { correct, eventId, now }) {
    if (previous?.recentEvents?.includes(eventId)) return previous;
    if (correct && !previous) return undefined;
    const streak = correct ? (previous?.correctStreak || 0) + 1 : 0;
    return {
        ...previous, ...snapshot, schemaVersion: 2,
        count: (Number(previous?.count) || 0) + (correct ? 0 : 1),
        firstMistake: previous?.firstMistake || previous?.lastMistake || now,
        lastMistake: correct ? previous.lastMistake : now,
        lastReviewed: now, lastResult: correct ? 'correct' : 'wrong', correctStreak: streak,
        status: correct && (streak >= 2 || previous?.status === 'mastered') ? 'mastered' : 'active',
        recentEvents: [...(previous?.recentEvents || []).slice(-19), eventId]
    };
}

export function preparePractice(m, original) {
    const snapshot = canonicalQuestion(m);
    const q = original ? { ...snapshot, ...original } : snapshot;
    if (q.options && Array.isArray(q.answer) && q.answer.length === 1) q.answer = q.answer[0];
    return { ...q, isFillBlank: !q.options, isMultiSelect: !!q.options && Array.isArray(q.answer) && q.answer.length > 1,
        isAnswered: false, isConfirmed: false, isCorrect: null, userSelection: null,
        reverseLabelMapping: null, mistakeQuizKey: m.quizKey, mistakeRecordPath: m.recordPath,
        sourcePath: m.sourcePath || m.quizKey };
}
