import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AgentError, createContentService } from '../scripts/agent/content.mjs';
import { normalizeQuestion } from '../src/features/learning/model.js';

const key = '生理學｜原考古';
const oldQuestion = { question: '原題幹', options: { A: '甲', B: '乙' }, answer: 'A', explanation: '原詳解', origin: '題本第 2 頁' };
const newBank = { title: '生理學｜新考古', questions: [{ ...oldQuestion, question: '新題幹' }] };
const isConflict = { status: 409, code: 'conflict' };

function fixture() {
    const contents = {
        quizCatalog: { [key]: { count: 2, storageKey: '原始作答識別' }, 其他: { count: 1, storageKey: '其他' } },
        [key]: [oldQuestion, { ...oldQuestion, questionId: 'q_existing', revision: 4, question: '下一題' }],
        progress: { learner: { quizzes: { 原始作答識別: { currentIndex: 1 } } } }
    };
    const data = structuredClone(contents);
    const writes = [];
    const getVersion = value => value === null ? 'null_etag' : `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`;
    const db = {
        async read(path) {
            const value = structuredClone(data[path] ?? null);
            return { value, version: getVersion(value) };
        },
        async put(path, value, version) {
            if (getVersion(data[path] ?? null) !== version) throw new AgentError(409, 'conflict', 'Record changed');
            data[path] = structuredClone(value);
            writes.push(path);
        }
    };
    return { agent: createContentService(db, { now: () => 200 }), db, contents, data, writes };
}

test('preflight checks source, answer alignment, reserved namespaces and image references without writes', async () => {
    const { agent, data, contents } = fixture();
    assert.equal((await agent.import({ banks: [newBank] })).banks[0].status, 'ready');
    await assert.rejects(agent.import({ apply: true, banks: [{ ...newBank, questions: [{ ...oldQuestion, answer: 'C' }] }] }), /選項與答案/);
    await assert.rejects(agent.import({ banks: [{ ...newBank, questions: [{ ...oldQuestion, origin: '' }] }] }), /origin/);
    await assert.rejects(agent.import({ banks: [{ ...newBank, questions: [{ ...oldQuestion, questionId: 'q_override' }] }] }), /不.*可寫入/);
    await assert.rejects(agent.import({ banks: [{ ...newBank, questions: [{ ...oldQuestion, image: { path: 'questionImages/missing', alt: '題圖' } }] }] }), /找不到題圖/);
    await assert.rejects(agent.get('progress'), { status: 400 });
    await assert.rejects(agent.get('不在目錄'), { status: 404 });
    assert.deepEqual(data, contents);
});

test('multi-bank publication stages immutable IDs then commits the catalog and recognizes replays after edits', async () => {
    const { agent, data, contents, writes } = fixture();
    const batch = { apply: true, banks: [newBank, { ...newBank, title: '生理學｜另一份' }] };
    const result = await agent.import(batch);
    assert.deepEqual(result.banks.map(bank => bank.status), ['created', 'created']);
    assert.deepEqual(writes, [newBank.title, '生理學｜另一份', 'quizCatalog']);
    const snapshot = await agent.get(newBank.title);
    const id = snapshot.questions[0].questionId;
    assert.match(id, /^q_[a-f0-9]{40}$/);
    assert.notEqual(id, data['生理學｜另一份'][0].questionId);
    await agent.edit({ apply: true, key: newBank.title, version: snapshot.version, edits: [{ questionId: id, set: { explanation: '新版詳解' }, reason: '修正' }] });
    assert.deepEqual((await agent.import(batch)).banks.map(bank => bank.status), ['already_imported', 'already_imported']);
    assert.equal(data[newBank.title][0].explanation, '新版詳解');
    assert.deepEqual(data.progress, contents.progress);
});

test('an import conflict never overwrites the catalog and an identical retry publishes already staged content', async () => {
    const { db, data } = fixture();
    const publish = db.put;
    let changed = false;
    db.put = async (path, value, version) => {
        if (path === 'quizCatalog' && !changed) {
            changed = true;
            data.quizCatalog.其他.count++;
        }
        return publish(path, value, version);
    };
    const agent = createContentService(db);
    const batch = { apply: true, banks: [newBank] };
    await assert.rejects(agent.import(batch), isConflict);
    assert.equal(data.quizCatalog[newBank.title], undefined);
    const staged = structuredClone(data[newBank.title]);
    await agent.import(batch);
    assert.equal(data.quizCatalog.其他.count, 2);
    assert.deepEqual(data[newBank.title], staged);
});

test('edits preserve stored and derived legacy IDs, keep row order and protect versions', async () => {
    const { agent, data, contents, writes } = fixture();
    const snapshot = await agent.get(key);
    const legacyId = normalizeQuestion(oldQuestion, key, 0).questionId;
    assert.equal(snapshot.questions[0].questionId, legacyId);
    const edit = { key, version: snapshot.version, edits: [{ questionId: legacyId, set: { question: '修正題幹', answer: 'B', explanation: '新版詳解' }, reason: '原卷勘誤' }] };
    assert.equal((await agent.edit(edit)).changes[0].revision, 2);
    assert.deepEqual(writes, []);
    await assert.rejects(agent.edit({ ...edit, edits: [{ ...edit.edits[0], set: { questionId: 'new_id' } }] }), /不.*可寫入/);
    await agent.edit({ ...edit, apply: true });
    assert.deepEqual(writes, [key]);
    assert.equal(data[key][0].questionId, legacyId);
    assert.equal(data[key][0].history[1].answer, 'A');
    assert.equal(data[key][0].history[1].reason, '原卷勘誤');
    assert.deepEqual(data[key][1], contents[key][1]);
    assert.deepEqual(data.progress, contents.progress);
    await assert.rejects(agent.edit({ ...edit, apply: true }), isConflict);
});

test('bulk rename keeps source paths, catalog storage keys, archived classification and attempt data', async () => {
    const { agent, data, contents, writes } = fixture();
    const { version } = await agent.list();
    const operations = { version, renames: [{ key, title: '解剖學｜新版' }, { key: '其他', title: '基礎｜其他' }] };
    await assert.rejects(agent.rename({ apply: true, version, renames: [{ key, title: '其他' }] }), isConflict);
    assert.equal((await agent.rename(operations)).changes.length, 2);
    assert.deepEqual(writes, []);
    await agent.rename({ ...operations, apply: true });
    assert.deepEqual(writes, ['quizCatalog']);
    assert.equal(data.quizCatalog[key].storageKey, '原始作答識別');
    assert.equal((await agent.get(key)).bank.title, '解剖學｜新版');
    assert.deepEqual(data[key], contents[key]);
    assert.deepEqual(data.progress, contents.progress);
    await assert.rejects(agent.rename({ ...operations, apply: true }), isConflict);
});

test('uploads generate reusable paths and never overwrite different bytes', async () => {
    const { agent, data, writes } = fixture();
    const image = { contentType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2XkAAAAASUVORK5CYII=' };
    const dryRun = await agent.image(image);
    assert.equal(dryRun.exists, false);
    const { path } = await agent.image({ ...image, apply: true });
    assert.equal(path, dryRun.path);
    assert.deepEqual(data[path], image);
    assert.equal((await agent.image({ ...image, apply: true })).exists, true);
    assert.deepEqual(writes, [path]);
    await assert.rejects(agent.image({ ...image, contentType: 'image/webp', apply: true }), /格式不符/);
});
