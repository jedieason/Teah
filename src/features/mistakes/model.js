import { normalizeQuestionOptions } from '../../shared/content.js';

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

export function getArchivedBankKeys(catalog = {}) {
    const archived = new Set();
    if (!catalog) return archived;
    const entries = Array.isArray(catalog) ? catalog.map(k => [k, {}])
        : catalog instanceof Set ? [...catalog].map(k => [k, {}])
        : Object.entries(catalog);

    const activeKeys = new Set();
    for (const [key, value] of entries) {
        if (typeof key !== 'string') continue;
        if (!key.startsWith('_Archive_')) {
            activeKeys.add(key);
            const clean = key.replace(/\.json$/, '');
            activeKeys.add(clean);
            activeKeys.add(clean.replace(/[.$#[\]/]/g, '_'));
            if (value?.storageKey) {
                activeKeys.add(value.storageKey);
                activeKeys.add(value.storageKey.replace(/[.$#[\]/]/g, '_'));
            }
        }
    }

    for (const [key, value] of entries) {
        if (typeof key !== 'string') continue;
        if (key.startsWith('_Archive_')) {
            archived.add(key);
            const clean = key.replace(/^_Archive_/, '').replace(/\.json$/, '');
            if (!activeKeys.has(clean)) {
                archived.add(clean);
                archived.add(clean.replace(/[.$#[\]/]/g, '_'));
            }
            if (value?.storageKey && !activeKeys.has(value.storageKey)) {
                archived.add(value.storageKey);
                archived.add(value.storageKey.replace(/[.$#[\]/]/g, '_'));
            }
        }
    }
    return archived;
}

export function isArchivedMistake(m, catalog = null) {
    if (!m) return false;
    const quizKey = typeof m === 'string' ? m : m.quizKey || '';
    const sourcePath = typeof m === 'object' ? m.sourcePath || '' : '';
    const origin = typeof m === 'object' ? m.origin || '' : '';
    if (quizKey.startsWith('_Archive_') || sourcePath.startsWith('_Archive_') || origin.startsWith('_Archive_')) return true;
    if (catalog) {
        const archived = catalog instanceof Set ? catalog : getArchivedBankKeys(catalog);
        if (quizKey && archived.has(quizKey)) return true;
        if (sourcePath && archived.has(sourcePath)) return true;
        const cleanQuizKey = quizKey.replace(/^_Archive_/, '').replace(/\.json$/, '');
        if (cleanQuizKey && archived.has(cleanQuizKey)) return true;
        const cleanSource = sourcePath.replace(/^_Archive_/, '').replace(/\.json$/, '');
        if (cleanSource && archived.has(cleanSource)) return true;
    }
    return false;
}

export function filterMistakes(items, { query = '', subject = '', subjects = null, quiz = '', status = 'active', sort = 'recent', catalog = null, excludeArchived = false } = {}) {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const rawSubjects = subjects ?? subject;
    const subjectList = (Array.isArray(rawSubjects) ? rawSubjects : [rawSubjects]).filter(Boolean);
    const subjectSet = subjectList.length ? new Set(subjectList) : null;
    const archived = excludeArchived ? (catalog instanceof Set ? catalog : getArchivedBankKeys(catalog)) : null;
    return items.filter(m => (!archived || !isArchivedMistake(m, archived))
        && (!subjectSet || subjectSet.has(m.subject)) && (!quiz || m.quizKey === quiz)
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
    const rawOptions = question.options ? Object.fromEntries(Object.entries(question.options).map(([k, v]) => [mapping[k] || k, v])) : null;
    const options = rawOptions ? normalizeQuestionOptions(rawOptions) : null;
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
    if (q.options) {
        if (Array.isArray(q.answer) && q.answer.length === 1) q.answer = q.answer[0];
        q.options = normalizeQuestionOptions(q.options);
    } else {
        delete q.options;
    }
    return { ...q, isFillBlank: !q.options, isMultiSelect: !!q.options && Array.isArray(q.answer) && q.answer.length > 1,
        isAnswered: false, isConfirmed: false, isCorrect: null, userSelection: null,
        reverseLabelMapping: null, mistakeQuizKey: m.quizKey, mistakeRecordPath: m.recordPath,
        sourcePath: m.sourcePath || m.quizKey };
}
