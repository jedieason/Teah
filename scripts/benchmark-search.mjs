import assert from 'node:assert/strict';
import { createQuestionIndex, normalizeSearchText } from '../src/features/search/model.js';

// Synthetic data only. Baseline fields are normalized once, favoring the linear scan.
const count = Number(process.argv[2] || 10000);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 100000);
const banks = Array.from({ length: Math.ceil(count / 250) }, (_, i) => `測試｜${i}`);
const rows = Array.from({ length: count }, (_, i) => ({ question: `第 ${i + 1} 題：${['細胞受體作用與訊息傳遞', '心血管系統與離子通道', '胸水檢查與診斷'][i % 3]}，選擇正確敘述。case ${i.toString(36).padStart(6, '0')}`,
    options: { A: `Acetylcholine receptor subtype ${i % 19}`, B: `sodium channel ${i % 37}`, C: 'pH < 6.5，代表檢查值', D: `Cell signaling pathway ${i % 71}` } }));
const fields = rows.map(q => [q.question, ...Object.values(q.options)].map(normalizeSearchText));
global.gc?.(); const before = process.memoryUsage().heapUsed;
const index = createQuestionIndex(), start = performance.now();
for (let i = 0; i < banks.length; i++) index.replaceBank(banks[i], rows.slice(i * 250, (i + 1) * 250));
const buildMs = performance.now() - start;
global.gc?.(); const heapMB = (process.memoryUsage().heapUsed - before) / 1048576;
const queries = ['受體', 'CHOLINE', 'pH < 6.5', '不存在的詞', `case ${(count - 1).toString(36).padStart(6, '0')}`];
const profiles = queries.map(query => {
    let indexedMs = 0, scannedMs = 0, matches;
    const needle = normalizeSearchText(query);
    for (let i = 0; i < 30; i++) {
        let at = performance.now(); const indexed = index.search(query); indexedMs += performance.now() - at;
        at = performance.now(); const scanned = fields.filter(values => values.some(field => field.includes(needle))); scannedMs += performance.now() - at;
        assert.equal(indexed.length, scanned.length); matches = indexed.length;
    }
    return { query, matches, indexedMs: +(indexedMs / 30).toFixed(3), scanMs: +(scannedMs / 30).toFixed(3) };
});
console.log(JSON.stringify({ questions: count, buildMs: Math.round(buildMs), indexHeapMB: +heapMB.toFixed(1), profiles }, null, 2));
