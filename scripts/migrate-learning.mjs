import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeQuestion } from '../src/features/learning/model.js';
const path = process.argv[2] || 'stock-market-ntumed-default-rtdb-export.json';
const data = JSON.parse(await readFile(path, 'utf8'));
try { await copyFile(path, `${path}.bak`, constants.COPYFILE_EXCL); } catch (e) { if (e.code !== 'EEXIST') throw e; }
const lookup = new Map(); let count = 0, mapped = 0, retired = 0;
data.quizCatalog ||= {};
for (const [bank, questions] of Object.entries(data)) {
    if (!Array.isArray(questions) || !questions.every(q => q && typeof q.question === 'string')) continue;
    data[bank] = questions.map((q, i) => {
        const out = normalizeQuestion({ ...q, questionId: q.questionId || `q_${randomUUID()}` }, bank, i);
        out.provenance ||= { status: 'legacy-unverified', source: q.origin || '', reviewedAt: null, reviewer: null, references: [] };
        const legacy = 'q_' + createHash('sha256').update(`${i}:${q.question}`).digest('hex');
        out.legacyIds = [...new Set([...(q.legacyIds || []), legacy])];
        for (const alias of [bank, bank.replace(/^_Archive_/, ''), data.quizCatalog[bank]?.storageKey].filter(Boolean)) lookup.set(`${alias}:${q.question}`, out);
        count++; return out;
    });
    data.quizCatalog[bank] = { ...data.quizCatalog[bank], count: questions.length, schemaVersion: 3 };
}
function walk(value, source = '') {
    if (!value || typeof value !== 'object') return;
    if (typeof value.question === 'string') {
        const q = lookup.get(`${value.sourcePath || value.source || source}:${value.question}`);
        if (q) { value.questionId = q.questionId; value.revision ||= q.revision; value.taxonomy ||= q.taxonomy; mapped++; }
        else { value.questionId ||= 'retired_' + createHash('sha256').update(`${value.sourcePath || value.source || source}:${value.originalIndex ?? -1}:${value.question}`).digest('hex'); value.revision ||= 1; value.identityStatus = 'unmatched-legacy-snapshot'; retired++; }
        return;
    }
    for (const [key, child] of Object.entries(value)) walk(child, (data.quizCatalog[key] || Object.values(data.quizCatalog).some(e => e.storageKey === key)) ? key : value.selectedJson || source);
}
for (const key of ['progress', 'mistakes', 'mistake']) walk(data[key]);
data.config ||= {}; data.config.learningSchemaVersion = 3;
await writeFile(path, JSON.stringify(data, null, 2) + '\n');
console.log(`Migrated ${count} questions; mapped ${mapped} saved snapshots; retained ${retired} unmatched snapshots with retired IDs. Original preserved as .bak; no historical attempts fabricated.`);
