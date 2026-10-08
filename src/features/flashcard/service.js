import { database, auth, ref, get, runTransaction } from '../../services/firebase.js';
import { storage, enqueue, flushOutbox, registerOutboxHandler } from '../../services/outbox.js';
import { mergeStudy, prepareDeck, hydrateSession, id } from './model.js';
import { generationRequest, parseGeneratedDeck } from './generation.js';
import { editingBatches, editingRequest, parseEditedBatch } from './editing.js';
const owner = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入。');
    return uid;
};
const ensure = uid => { if (uid !== auth.currentUser?.uid) throw new Error('帳戶已切換，請重新開啟 Flashcard。'); };
const cache = (uid, key, value) => storage('cache', 'put', { id: `flashcard:${uid}:${key}`, uid, value });
const readCache = async (uid, key) => (await storage('cache', 'get', `flashcard:${uid}:${key}`))?.value;
const status = detail => window.dispatchEvent(new CustomEvent('flashcard-sync', { detail }));
const pending = async uid => (await storage('outbox', 'getAll')).filter(i => i.uid === uid && i.kind === 'flashcard').sort((a, b) => a.createdAt - b.createdAt);
registerOutboxHandler('flashcard', async item => {
    const { uid, payload: p } = item; ensure(uid);
    try {
        if (p.op === 'deck') {
            const path = ref(database, `flashcard/${uid}/sets/${p.deck.id}`);
            // Warm the SDK cache before a revision-based abort: transactions may otherwise first receive null.
            await get(path); ensure(uid);
            const result = await runTransaction(path, previous => {
                if (previous?.operations?.[item.id]) return;
                if ((previous?.revision || 0) !== p.baseRevision) return;
                return { ...p.deck, operations: { ...previous?.operations, [item.id]: true } };
            }, { applyLocally: false });
            if (!result.committed && !result.snapshot.val()?.operations?.[item.id]) {
                const error = new Error('其他裝置已修改這組字卡。請保留本機版本為新字卡集，或重新載入雲端版本。'); error.code = 'flashcard/conflict'; throw error;
            }
            const publicPath = ref(database, `flashcard/publicSets/${p.deck.id}`);
            if (p.deck.isPublic && !p.deck.deletedAt) {
                const publicDeck = { ...p.deck, authorId: p.deck.authorId || uid };
                await runTransaction(publicPath, previous => {
                    if (previous?.operations?.[item.id]) return;
                    return { ...publicDeck, operations: { ...previous?.operations, [item.id]: true } };
                }, { applyLocally: false });
            } else {
                try {
                    const snap = await get(publicPath);
                    if (snap.exists() && snap.val()?.authorId === uid) {
                        await runTransaction(publicPath, () => null, { applyLocally: false });
                    }
                } catch {}
            }
        } else {
            const userDeck = (await get(ref(database, `flashcard/${uid}/sets/${p.deckId}`))).val();
            const deck = userDeck || (await get(ref(database, `flashcard/publicSets/${p.deckId}`)).catch(() => null))?.val();
            ensure(uid);
            if (!deck || deck.deletedAt) return; // A deleted set must never be recreated by late queued answers.
            await runTransaction(ref(database, `flashcard/${uid}/study/${p.deckId}`), previous => {
                const value = mergeStudy(previous, p.event, p.session);
                if (p.session && p.session.deckRevision !== deck.revision && value.sessions?.[p.session.mode]?.id === p.session.id) delete value.sessions[p.session.mode];
                return value;
            }, { applyLocally: false });
        }
        status({ uid, saved: true, deckId: p.deckId || p.deck.id });
    } catch (error) {
        status({ uid, error: error.code === 'flashcard/conflict' ? error.message : /permission/i.test(error.code || error.message) ? 'Firebase 尚未允許 Flashcard 存取；資料已保存在此裝置，套用規則後可重試同步。' : '資料已保存在此裝置，連線恢復後會重試同步。', conflict: error.code === 'flashcard/conflict', deckId: p.deckId || p.deck?.id });
        throw error;
    }
});
export async function loadDecks() {
    const uid = owner(); let userDecks = await readCache(uid, 'sets') || {}, publicDecks = await readCache(uid, 'publicSets') || {}, remote = false, error = '';
    try {
        const [userSnap, publicSnap] = await Promise.all([
            get(ref(database, `flashcard/${uid}/sets`)),
            get(ref(database, 'flashcard/publicSets')).catch(() => null)
        ]);
        ensure(uid);
        if (userSnap) { userDecks = userSnap.val() || {}; remote = true; }
        if (publicSnap && publicSnap.exists()) { publicDecks = publicSnap.val() || {}; }
    } catch (e) { error = /permission/i.test(e.code || e.message) ? 'Firebase 尚未允許 Flashcard 存取；目前使用此裝置的資料。' : '目前使用此裝置的資料。'; }
    ensure(uid);
    const items = await pending(uid); ensure(uid);
    for (const item of items) {
        if (item.payload.op === 'deck') {
            const d = item.payload.deck;
            userDecks[d.id] = d;
            if (d.isPublic && !d.deletedAt) publicDecks[d.id] = d;
            else delete publicDecks[d.id];
        }
    }
    await cache(uid, 'sets', userDecks);
    await cache(uid, 'publicSets', publicDecks);
    ensure(uid);
    const combined = { ...publicDecks, ...userDecks };
    return { decks: combined, remote, error, pending: items.length };
}
export async function saveDeck(draft, previous) {
    const uid = owner(), user = auth.currentUser;
    const authorFields = {
        authorId: draft.authorId || previous?.authorId || uid,
        authorName: draft.authorName || previous?.authorName || user?.displayName || user?.email?.split('@')[0] || '使用者',
        authorPhoto: draft.authorPhoto ?? previous?.authorPhoto ?? user?.photoURL ?? ''
    };
    const deck = prepareDeck({ ...authorFields, ...draft }, previous), decks = await readCache(uid, 'sets') || {}; ensure(uid);
    // Queue first: a failed local storage operation must not falsely report a successful save.
    await enqueue('flashcard', uid, { op: 'deck', deck, baseRevision: previous?.revision || 0 }); ensure(uid);
    decks[deck.id] = deck; await cache(uid, 'sets', decks);
    const publicDecks = await readCache(uid, 'publicSets') || {};
    if (deck.isPublic && !deck.deletedAt) publicDecks[deck.id] = deck;
    else delete publicDecks[deck.id];
    await cache(uid, 'publicSets', publicDecks);
    ensure(uid);
    return deck;
}
export async function changeDeleted(deck, deleted) {
    const uid = owner(), next = { ...deck, revision: deck.revision + 1, updatedAt: Date.now() };
    if (deleted) next.deletedAt = next.updatedAt; else delete next.deletedAt;
    await enqueue('flashcard', uid, { op: 'deck', deck: next, baseRevision: deck.revision }); ensure(uid);
    const decks = await readCache(uid, 'sets') || {}; decks[deck.id] = next;
    await cache(uid, 'sets', decks);
    const publicDecks = await readCache(uid, 'publicSets') || {};
    if (next.isPublic && !deleted) publicDecks[next.id] = next;
    else delete publicDecks[next.id];
    await cache(uid, 'publicSets', publicDecks);
    return next;
}
export async function loadStudy(deckId) {
    const uid = owner(); let study = await readCache(uid, `study:${deckId}`) || {};
    try { const snapshot = await get(ref(database, `flashcard/${uid}/study/${deckId}`)); ensure(uid); study = snapshot.val() || {}; } catch { /* Durable local snapshot and pending operations remain usable. */ }
    ensure(uid);
    for (const item of await pending(uid)) if (item.payload.op === 'study' && item.payload.deckId === deckId) study = mergeStudy(study, item.payload.event, item.payload.session);
    ensure(uid);
    for (const [mode, session] of Object.entries(study.sessions || {})) study.sessions[mode] = hydrateSession(session);
    await cache(uid, `study:${deckId}`, study); return study;
}
export async function saveStudy(deckId, study, event = null, session = null) {
    const uid = owner(), next = mergeStudy(study, event, session);
    await enqueue('flashcard', uid, { op: 'study', deckId, event, session }); ensure(uid);
    await cache(uid, `study:${deckId}`, next); ensure(uid);
    return next;
}
let lastEventAt = 0;
export const newEvent = (kind, fields = {}) => ({ id: id(), kind, at: (lastEventAt = Math.max(Date.now(), lastEventAt + 1)), ...fields });
export async function saveDraft(deckId, draft) { const uid = owner(); await cache(uid, `draft:${deckId || 'new'}`, draft); ensure(uid); }
export async function readDraft(deckId) { const uid = owner(), value = await readCache(uid, `draft:${deckId || 'new'}`); ensure(uid); return value; }
export async function clearDraft(deckId) { const uid = owner(); await storage('cache', 'delete', `flashcard:${uid}:draft:${deckId || 'new'}`); }
export async function discardConflicts(deckId) {
    const uid = owner();
    for (const item of await pending(uid)) if ((item.payload.deck?.id || item.payload.deckId) === deckId) await storage('outbox', 'delete', item.id);
    await storage('cache', 'delete', `flashcard:${uid}:study:${deckId}`); ensure(uid);
}
export { flushOutbox };

export async function generateDeck(sources, instructions, signal) {
    const text = await requestCardAI(generationRequest(sources, instructions), signal);
    return parseGeneratedDeck(text, sources);
}
async function requestCardAI(request, signal, editing = false) {
    const uid = owner();
    signal.throwIfAborted();
    let abortListener;
    try {
        console.log('[FlashcardGen] 正在自 Firebase 讀取 API_KEY...');
        const key = await Promise.race([get(ref(database, 'API_KEY')).then(s => s.val()), new Promise((_, reject) => {
            abortListener = () => reject(new DOMException('已取消生成。', 'AbortError'));
            signal.addEventListener('abort', abortListener, { once: true });
        })]); ensure(uid); signal.throwIfAborted();
        if (typeof key !== 'string' || !key.trim()) {
            console.error('[FlashcardGen] Firebase /API_KEY 為空或未設定');
            throw new Error('AI 服務尚未設定。');
        }
        console.log('[FlashcardGen] 正在呼叫 Gemini API...');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal
        }); ensure(uid); signal.throwIfAborted();
        if (!response.ok) {
            const errDetails = await response.text().catch(() => '');
            console.error('[FlashcardGen] Gemini API 回傳錯誤：', response.status, errDetails);
            throw new Error(response.status === 429 ? 'AI 使用量暫時達上限，請稍後重試。' : editing ? 'AI 暫時無法編輯字卡，請重試。' : 'AI 暫時無法生成字卡，請重試。');
        }
        const result = await response.json(), candidate = result.candidates?.[0]; ensure(uid); signal.throwIfAborted();
        if (candidate?.finishReason !== 'STOP') {
            console.error('[FlashcardGen] Gemini 未正常完成，finishReason:', candidate?.finishReason);
            throw new Error(editing ? '字卡未完整編輯，原內容未修改。' : '字卡未完整生成，請重試。');
        }
        return candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    } finally { signal.removeEventListener('abort', abortListener); }
}
export async function editDeckWithAI(draft, instructions, signal, onProgress) {
    const uid = owner(), batches = editingBatches(draft), cards = new Map(); let metadata;
    for (const [i, batch] of batches.entries()) {
        ensure(uid); signal.throwIfAborted(); onProgress?.(i + 1, batches.length);
        const controller = new AbortController(), cancel = () => controller.abort();
        signal.addEventListener('abort', cancel, { once: true });
        const timeout = setTimeout(cancel, 90000);
        try {
            const text = await requestCardAI(editingRequest(draft, batch, instructions, metadata), controller.signal, true);
            ensure(uid); signal.throwIfAborted();
            const edited = parseEditedBatch(text, batch, metadata);
            metadata ||= Object.fromEntries(['title', 'description', 'termLanguage', 'definitionLanguage'].map(k => [k, edited[k]]));
            edited.cards.forEach(c => cards.set(c.id, c));
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
    }
    ensure(uid); signal.throwIfAborted();
    return { ...draft, ...metadata, cards: draft.cards.map(c => cards.get(c.id) || c) };
}
