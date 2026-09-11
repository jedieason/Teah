import { database, ref, get, update } from './firebase.js';

export const reservedKeys = new Set(['progress', 'mistakes', 'mistake', 'API_KEY', 'quizCatalog', 'quizAliases', 'config']);
export const validBankName = name => !!name.trim() && !/[.#$\[\]/]/.test(name) && !reservedKeys.has(name);

export async function readCatalog() {
    // A dedicated catalog lets rules deny root reads without moving legacy banks.
    const catalog = await get(ref(database, 'quizCatalog'));
    if (catalog.exists()) return catalog.val();
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
    await update(ref(database), updates);
}
