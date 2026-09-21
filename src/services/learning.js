import { database, auth, ref, get, runTransaction } from './firebase.js';
import { enqueue, installOutbox, flushOutbox, storage } from './outbox.js';
import { applyLearningEvent, normalizeQuestion, schedule } from '../features/learning/model.js';
import { applyAttempt } from '../features/mistakes/model.js';
export let learningState = {};
let owner = null;
const cacheState = async uid => storage('cache', 'put', { id: `learning:${uid}`, uid, value: learningState });
installOutbox(() => auth.currentUser?.uid, async item => {
    const { uid, payload: p } = item;
    if (item.kind === 'attempt') {
        const saved = await runTransaction(ref(database, `learning/${uid}/attempts/${p.event.eventId}`), old => old ? undefined : p.event, { applyLocally: false });
        const event = saved.snapshot.val();
        if (!event) throw new Error('Attempt acknowledgement missing');
        await runTransaction(ref(database, `learning/${uid}/reviews/${p.event.questionId}`), old => {
            const events = { ...old?.events, [event.eventId]: event };
            const review = Object.values(events).sort((a, b) => a.submittedAt - b.submittedAt || a.eventId.localeCompare(b.eventId)).reduce(schedule, undefined);
            return { ...review, events };
        }, { applyLocally: false });
        await runTransaction(ref(database, `mistakes/${uid}/${p.quizKey}/${p.recordPath}`), previous => {
            if (previous?.processedEvents?.[event.eventId]) return;
            const next = applyAttempt(previous, p.snapshot, { correct: event.isCorrect, eventId: event.eventId, now: event.submittedAt });
            return next ? { ...next, processedEvents: { ...previous?.processedEvents, [event.eventId]: true } } : undefined;
        }, { applyLocally: false });
    } else if (item.kind === 'progress') {
        await runTransaction(ref(database, `progress/${uid}/quizzes/${p.quizKey}`), old => old?.lastUpdated > p.progress.lastUpdated ? undefined : p.progress, { applyLocally: false });
        await runTransaction(ref(database, `progress/${uid}/lastActive`), old => old?.lastUpdated > p.progress.lastUpdated ? undefined : { quizName: p.quizKey, selectedJson: p.progress.selectedJson, lastUpdated: p.progress.lastUpdated }, { applyLocally: false });
    } else if (item.kind === 'preference') {
        await runTransaction(ref(database, `learning/${uid}/${p.key}`), old => old?.updatedAt > p.value.updatedAt ? undefined : p.value, { applyLocally: false });
    }
});
export async function loadLearning() {
    const uid = auth.currentUser?.uid;
    owner = uid; learningState = {};
    if (!uid) return;
    const cached = await storage('cache', 'get', `learning:${uid}`);
    if (owner !== uid) return;
    learningState = cached?.value || {};
    try {
        const snap = await get(ref(database, `learning/${uid}`));
        if (owner !== uid) return;
        learningState = snap.val() || {};
    } catch { /* Offline cache remains usable. */ }
    const pending = await storage('outbox', 'getAll');
    if (owner !== uid) return;
    for (const item of pending) if (item.uid === uid) {
        if (item.kind === 'attempt') learningState = applyLearningEvent(learningState, item.payload.event);
        if (item.kind === 'preference') learningState[item.payload.key] = item.payload.value;
    }
    await cacheState(uid); void flushOutbox();
}
export async function recordLearning(payload) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await enqueue('attempt', uid, payload);
    if (owner === uid) { learningState = applyLearningEvent(learningState, payload.event); await cacheState(uid); }
}
export async function savePreference(key, value) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入。');
    const record = { ...value, updatedAt: Date.now() };
    await enqueue('preference', uid, { key, value: record });
    if (owner === uid) { learningState[key] = record; await cacheState(uid); }
}
export async function readBank(path) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入。');
    const id = `bank:${uid}:${path}`;
    try {
        const snap = await get(ref(database, path));
        const value = snap.val();
        if (!Array.isArray(value) || !value.length) throw new Error('題庫沒有可用題目。');
        const normalized = value.map((q, i) => normalizeQuestion(q, path, i));
        await storage('cache', 'put', { id, uid, value: normalized }); return normalized;
    } catch (error) {
        // Never bypass a permission rejection with stale data.
        if (String(error.code || error.message).toLowerCase().includes('permission')) throw error;
        const cached = await storage('cache', 'get', id); if (cached) return cached.value; throw error;
    }
}
