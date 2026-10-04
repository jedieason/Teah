import { createQuestionIndex, isArchivedBank } from './model.js';

// Load at most four banks concurrently, only after a search in that scope.
// Owner/catalog generations ensure late reads cannot repopulate a cleared index.
export function createSearchLoader({ readBank, plainText, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    let owner = null, generation = 0, catalog = null;
    let scopes = new Map();
    const clear = () => { generation++; scopes = new Map(); };
    return {
        resetForUser(uid) { if (owner !== (uid || null)) { owner = uid || null; clear(); } },
        setCatalog(value) { catalog = value; clear(); },
        async load(archived, onProgress = () => {}) {
            if (!owner || !catalog) return null;
            let state = scopes.get(archived);
            if (!state) {
                state = { index: createQuestionIndex(), loaded: new Set(), failures: [], pending: null, done: 0, total: 0, listeners: new Set() };
                scopes.set(archived, state);
            }
            state.listeners.add(onProgress);
            const report = () => { for (const listener of state.listeners) listener({ done: state.done, total: state.total }); };
            if (!state.pending) {
                const paths = Object.keys(catalog).filter(path => isArchivedBank(path) === archived && !state.loaded.has(path));
                state.failures = []; state.done = 0; state.total = paths.length;
                const id = generation;
                const run = async () => {
                    let cursor = 0;
                    await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
                        while (id === generation && cursor < paths.length) {
                            const path = paths[cursor++];
                            try {
                                const questions = await readBank(path);
                                if (id !== generation) return;
                                state.index.replaceBank(path, questions, plainText); state.loaded.add(path);
                            } catch { if (id === generation) state.failures.push(path); }
                            if (id !== generation) return;
                            state.done++; report(); await yieldTask();
                        }
                    }));
                    return id === generation ? { index: state.index, failures: [...state.failures] } : null;
                };
                state.pending = run().finally(() => { state.pending = null; });
            }
            report();
            try { return await state.pending; } finally { state.listeners.delete(onProgress); }
        }
    };
}
