export const normalizeSearchText = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
export const isArchivedBank = path => path.startsWith('_Archive_');

function grams(text, size) {
    const characters = Array.from(text), result = new Set();
    for (let i = 0; i <= characters.length - size; i++) result.add(characters.slice(i, i + size).join(''));
    return result;
}
const fieldGrams = (fields, size) => new Set(fields.flatMap(field => [...grams(field.text, size)]));
function contains(list, id) {
    let low = 0, high = list.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (list[middle] === id) return true;
        if (list[middle] < id) low = middle + 1; else high = middle - 1;
    }
    return false;
}

// Character postings support Chinese and infixes without a language-specific tokenizer.
// Each field is indexed separately; final substring verification rejects false positives.
export function createQuestionIndex() {
    const documents = new Map(), postings = [null, new Map(), new Map(), new Map()], banks = new Map();
    let nextId = 0;
    function removeBank(path) {
        const ids = new Set(banks.get(path) || []);
        for (let size = 1; size <= 3; size++) {
            const affected = new Set();
            for (const id of ids) for (const gram of fieldGrams(documents.get(id).fields, size)) affected.add(gram);
            for (const gram of affected) {
                const list = postings[size].get(gram).filter(id => !ids.has(id));
                if (list.length) postings[size].set(gram, list); else postings[size].delete(gram);
            }
        }
        for (const id of ids) documents.delete(id);
        banks.delete(path);
    }
    return {
        replaceBank(path, questions, plainText = String) {
            removeBank(path);
            const ids = [];
            questions.forEach((question, originalIndex) => {
                const fields = [{ key: 'question', text: normalizeSearchText(plainText(question.question || '')) },
                    ...Object.entries(question.options || {}).map(([key, value]) => ({ key, text: normalizeSearchText(plainText(value)) }))];
                const doc = { path, question: { ...question, sourcePath: path, originalIndex }, fields };
                const id = nextId++; ids.push(id); documents.set(id, doc);
                for (let size = 1; size <= 3; size++) {
                    for (const gram of fieldGrams(fields, size)) {
                        if (!postings[size].has(gram)) postings[size].set(gram, []);
                        postings[size].get(gram).push(id);
                    }
                }
            });
            banks.set(path, ids);
        },
        removeBank,
        search(value, { archived = false } = {}) {
            const query = normalizeSearchText(value);
            if (!query) return [];
            const size = Math.min(3, Array.from(query).length);
            const lists = [...grams(query, size)].map(gram => postings[size].get(gram));
            if (lists.some(list => !list)) return [];
            lists.sort((a, b) => a.length - b.length);
            const matches = [];
            for (const id of lists[0]) {
                if (!lists.every(list => contains(list, id))) continue;
                const doc = documents.get(id);
                if (isArchivedBank(doc.path) !== archived) continue;
                const fields = doc.fields.filter(field => field.text.includes(query)).map(field => field.key);
                if (fields.length) matches.push({ question: doc.question, fields });
            }
            return matches.sort((a, b) => Number(b.fields.includes('question')) - Number(a.fields.includes('question'))
                || a.question.sourcePath.localeCompare(b.question.sourcePath, 'zh-Hant') || a.question.originalIndex - b.question.originalIndex);
        },
        get size() { return documents.size; }
    };
}
