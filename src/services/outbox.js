import { diagnostic } from './diagnostics.js';
// Durable, account-scoped queue. A record is removed only after server acknowledgement.
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('teah-learning-v1', 1);
    request.onupgradeneeded = () => { for (const name of ['outbox', 'cache']) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export async function storage(store, action, value) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, action === 'get' || action === 'getAll' ? 'readonly' : 'readwrite');
        const request = tx.objectStore(store)[action](value);
        tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
}
let handler, getUid, busy = false;
const suspended = new Set();
export async function suspendAccount(uid) { suspended.add(uid); while (busy) await new Promise(resolve => setTimeout(resolve, 100)); }
export function resumeAccount(uid) { suspended.delete(uid); void flushOutbox(); }
export function installOutbox(uid, send) { getUid = uid; handler = send; window.addEventListener('online', flushOutbox); setInterval(flushOutbox, 30000); }
export async function enqueue(kind, uid, payload) {
    const item = { id: crypto.randomUUID(), kind, uid, payload, createdAt: Date.now() };
    await storage('outbox', 'put', item);
    void flushOutbox();
    return item;
}
export async function flushOutbox() {
    if (busy || !getUid?.() || suspended.has(getUid())) return;
    busy = true;
    let retrySoon = false;
    try {
        const items = (await storage('outbox', 'getAll')).filter(i => i.uid === getUid()).sort((a, b) => a.createdAt - b.createdAt);
        window.dispatchEvent(new CustomEvent('sync-status', { detail: { pending: items.length } }));
        for (const item of items) {
            if (item.uid !== getUid() || suspended.has(item.uid)) break;
            const start = performance.now();
            await handler(item);
            diagnostic('sync-complete', { kind: item.kind, durationMs: Math.round(performance.now() - start) });
            await storage('outbox', 'delete', item.id);
        }
        const pending = (await storage('outbox', 'getAll')).filter(i => i.uid === getUid()).length;
        retrySoon = pending > 0;
        window.dispatchEvent(new CustomEvent('sync-status', { detail: { pending } }));
    } catch (error) {
        window.dispatchEvent(new CustomEvent('sync-status', { detail: { error: error.code || 'sync-failed' } }));
    } finally { busy = false; if (retrySoon) setTimeout(flushOutbox, 0); }
}
export async function clearAccountCache(uid) {
    for (const store of ['outbox', 'cache']) for (const item of await storage(store, 'getAll')) if (item.uid === uid) await storage(store, 'delete', item.id);
}
