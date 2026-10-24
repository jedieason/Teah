import { storage } from './outbox.js';
import { normalizeQuestion } from '../features/learning/model.js';
import { database, auth, ref, get, update } from './firebase.js';

export const reservedKeys = new Set(['progress', 'mistakes', 'mistake', 'API_KEY', 'quizCatalog', 'quizAliases', 'config', 'learning', 'contentDrafts', 'auditLog', 'feedback', 'flashcard', '__empty']);
export const validBankName = name => !!name.trim() && !/[.#$\[\]/]/.test(name) && !reservedKeys.has(name);

export async function bankExists(name) {
    if (!name) return false;
    try {
        const snap = await get(ref(database, `quizCatalog/${name}`));
        if (snap.exists()) return true;
        const catalogSnap = await get(ref(database, 'quizCatalog'));
        if (catalogSnap.exists()) return false;
    } catch {}
    try {
        const entries = await readCatalog();
        return Boolean(entries && Object.prototype.hasOwnProperty.call(entries, name));
    } catch {
        return false;
    }
}

export async function readCatalog() {
    // A dedicated catalog lets rules deny root reads without moving legacy banks.
    let catalog;
    const uid = auth.currentUser?.uid || 'public';
    try {
        catalog = await get(ref(database, 'quizCatalog'));
        if (catalog.exists()) {
            const value = Object.fromEntries(Object.entries(catalog.val()).filter(([key]) => key !== '__empty'));
            await storage('cache', 'put', { id: `catalog:${uid}`, uid, value }); return value;
        }
    } catch (error) {
        if (/permission/i.test(error.code || error.message)) throw error;
        const cached = await storage('cache', 'get', `catalog:${uid}`); if (cached) return cached.value; throw error;
    }
    try {
        const root = await get(ref(database));
        return Object.fromEntries(Object.entries(root.val() || {}).filter(([key, value]) => !reservedKeys.has(key) && Array.isArray(value))
            .map(([key, value]) => [key, { count: value.length }]));
    } catch (error) {
        if (error?.message?.includes('Permission denied') || error?.code === 'PERMISSION_DENIED') {
            console.error('Firebase 根目錄讀取已被權限規則拒絕，且尚未建立 /quizCatalog 節點。請先於 Firebase Console 建立或匯入 /quizCatalog。');
            throw new Error('題庫目錄 (/quizCatalog) 尚未在 Firebase 建立，且安全規則已禁止讀取根目錄。請先匯入或建立 /quizCatalog。');
        }
        throw error;
    }
}

export async function writeBanks(changes) {
    const uid = auth.currentUser?.uid;
    changes = Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value?.map((q, i) => normalizeQuestion({ ...q, questionId: q.questionId || `q_${crypto.randomUUID()}` }, key, i)) || null]));
    const updates = { ...changes };
    const entries = await readCatalog();
    const storageKey = key => entries[key]?.storageKey || key.replace(/^_Archive_/, '').replace(/\.json$/, '').replace(/[.$#[\]/]/g, '_');
    const removed = Object.keys(changes).filter(key => changes[key] === null);
    for (const [key, value] of Object.entries(changes)) {
        if (!validBankName(key)) throw new Error('題庫名稱不可包含 . # $ [ ] /，也不可使用系統保留名稱。');
        updates[`quizCatalog/${key}`] = value === null ? null : { count: value.length, storageKey: storageKey(removed.find(old => old.replace(/^_Archive_/, '') === key.replace(/^_Archive_/, '')) || (removed.length === 1 ? removed[0] : key)) };
    }
    // Initialize the complete catalog before the first legacy bank edit.
    const catalog = await get(ref(database, 'quizCatalog'));
    if (!catalog.exists()) {
        for (const [key, value] of Object.entries(entries)) if (!(`quizCatalog/${key}` in updates)) updates[`quizCatalog/${key}`] = value;
    }
    // Firebase removes empty objects. Keep an empty catalog readable when the last bank is deleted.
    const nextCatalog = { ...entries };
    for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete nextCatalog[key]; else nextCatalog[key] = updates[`quizCatalog/${key}`];
    }
    updates['quizCatalog/__empty'] = Object.keys(nextCatalog).length ? null : true;
    if (uid !== auth.currentUser?.uid) throw new Error('登入狀態已變更，請重試。');
    await update(ref(database), updates);
    // A successful content mutation must not leave an old bank available from this device's cache.
    // Cache failures must never turn a committed server write into a retry of that write.
    try {
        const cached = await storage('cache', 'getAll');
        await Promise.allSettled(cached.filter(item => item.id.startsWith('catalog:') ||
            Object.keys(changes).some(key => item.id === `bank:${item.uid}:${key}`))
            .map(item => storage('cache', 'delete', item.id)));
    } catch (error) { console.warn('Catalog cache invalidation failed:', error); }
}

// Read the source from the server, never from an offline snapshot, before moving it.
export async function changeBanks(action, keys, renamed = '') {
    const uid = auth.currentUser?.uid;
    const names = [...new Set(keys)];
    if (!auth.currentUser) throw new Error('請先登入。');
    if (!names.length || !['rename', 'archive', 'delete'].includes(action)) throw new Error('請選取題庫。');
    if (action === 'rename' && names.length !== 1) throw new Error('每次只能重新命名一份題庫。');
    const changes = {};
    for (const oldName of names) {
        if (!validBankName(oldName)) throw new Error('題庫名稱格式不正確。');
        if (action !== 'delete') {
            const newName = action === 'rename' ? renamed : oldName.startsWith('_Archive_') ? oldName.slice(9) : `_Archive_${oldName}`;
            if (!validBankName(newName)) throw new Error('題庫名稱不可包含 . # $ [ ] /，也不可使用系統保留名稱。');
            if (newName === oldName) continue;
            if (await bankExists(newName)) throw new Error('此名稱已存在，請使用其他名稱。');
            const snapshot = await get(ref(database, oldName));
            if (!snapshot.exists()) throw new Error('找不到原題庫，請重新載入。');
            changes[newName] = snapshot.val();
        }
        changes[oldName] = null;
    }
    if (uid !== auth.currentUser?.uid) throw new Error('登入狀態已變更，請重試。');
    if (Object.keys(changes).length) await writeBanks(changes);
    return changes;
}
