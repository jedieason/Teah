export const DAY = 86400000;
export function normalizeQuestion(q, source = '', index = 0) {
    // Legacy fallback is deterministic until the export migration is uploaded.
    let hash = 2166136261;
    for (const c of `${source}:${index}:${q.question}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return { ...q, questionId: q.questionId || `legacy_${(hash >>> 0).toString(16)}`, revision: q.revision || 1,
        taxonomy: { subject: source.replace(/^_Archive_/, '').split(/[｜|/]/)[0] || '未分類', system: '', topic: '', subtopic: '', competency: '', difficulty: '', year: '', tags: [], ...q.taxonomy } };
}
export function schedule(previous, event) {
    const streak = event.isCorrect ? (previous?.streak || 0) + 1 : 0;
    const intervalDays = event.isCorrect ? Math.min(90, streak === 1 ? 1 : (previous?.intervalDays || 1) * 2) : 1;
    return { streak, intervalDays, dueAt: event.submittedAt + intervalDays * DAY, lastAt: event.submittedAt,
        lastCorrect: event.isCorrect, attempts: (previous?.attempts || 0) + 1, sourcePath: event.sourcePath };
}
export function applyLearningEvent(state, event) {
    state ||= {};
    if (state.attempts?.[event.eventId]) return state;
    const attempts = { ...state.attempts, [event.eventId]: event };
    // Replay by event time so reconnect order cannot change scheduling.
    const history = Object.values(attempts).filter(e => e.questionId === event.questionId)
        .sort((a, b) => a.submittedAt - b.submittedAt || a.eventId.localeCompare(b.eventId));
    const review = history.reduce(schedule, undefined);
    return { ...state, attempts, reviews: { ...state.reviews, [event.questionId]: review } };
}
export function selectQuestions(items, filters = {}, state = {}, now = Date.now()) {
    const attempts = Object.values(state.attempts || {});
    let result = items.filter(q => {
        const t = q.taxonomy || {}, r = state.reviews?.[q.questionId];
        return ['subject', 'system', 'topic', 'difficulty', 'year'].every(k => !filters[k] || String(t[k] || '') === String(filters[k]))
            && (!filters.query || [q.question, ...Object.values(t)].join(' ').toLowerCase().includes(filters.query.toLowerCase()))
            && (!filters.status || filters.status === 'all' || (filters.status === 'new' && !r)
                || (filters.status === 'wrong' && r?.lastCorrect === false) || (filters.status === 'due' && r?.dueAt <= now)
                || (filters.status === 'starred' && q.starred));
    });
    if (filters.order === 'adaptive') {
        const stats = {};
        for (const e of attempts) { const key = e.taxonomy?.topic || e.taxonomy?.subject || '未分類'; const s = stats[key] ||= [0, 0]; s[0]++; s[1] += Number(e.isCorrect); }
        const rank = q => { const r = state.reviews?.[q.questionId]; const s = stats[q.taxonomy?.topic || q.taxonomy?.subject || '未分類']; return (r?.dueAt <= now ? 4 : 0) + (r?.lastCorrect === false ? 2 : 0) + (s ? 1 - s[1] / s[0] : 1); };
        result.sort((a, b) => rank(b) - rank(a));
    } else if (filters.order === 'random') {
        for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    }
    return result.slice(0, Math.max(1, Math.min(200, Number(filters.count) || 20)));
}
export function summarize(attempts, since = 0) {
    const rows = Object.values(attempts || {}).filter(e => e.submittedAt >= since);
    return { count: rows.length, accuracy: rows.length ? Math.round(100 * rows.filter(e => e.isCorrect).length / rows.length) : null,
        seconds: rows.length ? Math.round(rows.reduce((n, e) => n + (e.responseTimeMs || 0), 0) / rows.length / 1000) : 0 };
}
