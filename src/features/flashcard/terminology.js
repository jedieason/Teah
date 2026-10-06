import { answerKey } from './model.js';
const termKey = value => answerKey(value).replace(/\s/g, '');
let database;

export function conceptIndex(data) {
    const index = new Map();
    for (const [id, terms] of data.concepts) for (const term of terms) {
        const key = termKey(term), ids = index.get(key) || new Set();
        ids.add(id); index.set(key, ids);
    }
    return index;
}

export function compareConcepts(index, reference, candidate) {
    const a = index.get(termKey(reference)), b = index.get(termKey(candidate));
    // Ambiguous names must proceed to context-dependent model inference.
    if (!a || !b || a.size !== 1 || b.size !== 1) return null;
    return [...a][0] === [...b][0] ? 'same' : 'different';
}

export async function terminologyComparison(reference, candidate) {
    if (!database) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
        database = fetch(new URL('./data/mesh-concepts.json', import.meta.url), { signal: controller.signal }).then(async response => {
            if (!response.ok) throw new Error('Terminology unavailable');
            return conceptIndex(await response.json());
        }).catch(error => { database = null; throw error; }).finally(() => clearTimeout(timeout));
    }
    return compareConcepts(await database, reference, candidate);
}
