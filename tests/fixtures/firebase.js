// Browser test double: no requests or writes reach Firebase.
const user = { uid: 'test-user', displayName: '測試帳號', email: 'student@example.test', photoURL: '', getIdTokenResult: async () => ({ claims: window.__claims || {} }) };
export const auth = { currentUser: user };
export const database = {};
export const googleProvider = {};
const db = window.__testDatabase;
const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
const read = path => path.split('/').filter(Boolean).reduce((value, key) => value?.[key], db) ?? null;
const snapshot = value => ({ exists: () => value !== null, val: () => clone(value) });
const write = (path, value) => {
    const parts = path.split('/').filter(Boolean); let node = db;
    for (const part of parts.slice(0, -1)) node = node[part] ||= {};
    if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = clone(value);
};
export const ref = (_, path = '') => path;
export async function get(path) { if (window.__failReads?.some(p => path.startsWith(p))) throw new Error('Test read failure'); return snapshot(read(path)); }
export async function set(path, value) { write(path, value); }
export async function remove(path) { write(path, null); }
export async function update(path, values) { for (const [key, value] of Object.entries(values)) write(`${path}/${key}`, value); }
export async function runTransaction(path, callback) {
    if (window.__failWrites) throw new Error('Test write failure');
    const value = callback(clone(read(path)));
    if (value !== undefined) write(path, value);
    return { committed: value !== undefined, snapshot: snapshot(read(path)) };
}
export function onAuthStateChanged(_, callback) { setTimeout(() => callback(user), 0); }
export async function signInWithPopup() { return { user }; }
export async function signOut() { auth.currentUser = null; }

export async function deleteUser() { auth.currentUser = null; }
export async function reauthenticateWithPopup() {}
