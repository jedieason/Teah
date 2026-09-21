import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('migration preserves banks, secrets, original backup and legacy archive references across reruns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teah-migration-')); const file = join(dir, 'export.json');
    const q = { question: 'Question', options: { A: 'one', B: 'two' }, answer: 'A' };
    const data = { API_KEY: 'test-value', '_Archive_科目｜試題': [q], quizCatalog: { '_Archive_科目｜試題': { storageKey: '科目｜試題' } }, mistakes: { user: { '科目｜試題': { old: q, retired: { ...q, question: 'Deleted question' } } } } };
    try {
        await writeFile(file, JSON.stringify(data)); execFileSync(process.execPath, ['scripts/migrate-learning.mjs', file]);
        const first = JSON.parse(await readFile(file)); execFileSync(process.execPath, ['scripts/migrate-learning.mjs', file]);
        const second = JSON.parse(await readFile(file)); assert.deepEqual(first, second); assert.deepEqual(JSON.parse(await readFile(`${file}.bak`)), data);
        const migrated = first['_Archive_科目｜試題'][0]; for (const key of Object.keys(q)) assert.deepEqual(migrated[key], q[key]);
        assert.equal(first.API_KEY, data.API_KEY); assert.equal(first.mistakes.user['科目｜試題'].old.questionId, migrated.questionId);
        assert.match(first.mistakes.user['科目｜試題'].retired.questionId, /^retired_/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
