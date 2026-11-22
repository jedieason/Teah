import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { get, ref, set } from 'firebase/database';
import { createContentService } from '../scripts/agent/content.mjs';
import { createDatabase } from '../scripts/agent/firebase.mjs';
import { createAgentServer, listenOnLoopback } from '../scripts/agent/http.mjs';

export async function testAgentApi(env, port) {
    const alice = env.authenticatedContext('agent-api-learner').database();
    const anon = env.unauthenticatedContext().database();
    const backend = createDatabase(`http://127.0.0.1:${port}/?ns=demo-teah`, { getToken: async () => 'owner' });
    const token = 'local-emulator-token-for-integration-tests';
    const server = createAgentServer(createContentService(backend), token);
    const address = await listenOnLoopback(server, 0);

    async function request(path, body, status = 200) {
        const response = await fetch(`${address}${path}`, {
            method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body && JSON.stringify(body)
        });
        assert.equal(response.status, status, `${path} ${await response.clone().text()}`);
        return response.json();
    }

    try {
        const unauthenticated = await fetch(`${address}/v1/banks`);
        assert.equal(unauthenticated.status, 401);
        await request('/v1/bank?key=API_KEY', null, 400);
        await request('/v1/bank?key=progress', null, 400);

        const key = '端點測試｜題庫';
        const bankPath = `/v1/bank?${new URLSearchParams({ key })}`;
        const original = { question: '測試題幹', options: { A: '甲', B: '乙' }, answer: 'A', explanation: '測試詳解。', origin: '測試資料第 1 頁，第 1 題' };
        const bank = { title: key, questions: [original] };
        assert.equal((await request('/v1/banks/import', { banks: [bank] })).banks[0].status, 'ready');
        await assertFails(get(ref(alice, key)));
        await request('/v1/banks/import', { banks: [bank], apply: true });
        await assertFails(get(ref(anon, key)));
        await assertSucceeds(set(ref(alice, `progress/agent-api-learner/quizzes/${key}`), { currentIndex: 1 }));
        const initial = await request(bankPath);
        const questionId = initial.questions[0].questionId;
        const edit = { apply: true, key, version: initial.version, edits: [{ questionId, set: { question: '新版題幹' }, reason: '格式勘誤' }] };
        await request('/v1/banks/edit', edit);
        await request('/v1/banks/edit', edit, 409);
        await assert.rejects(backend.put(key, [original], initial.version), { status: 409 });

        const catalog = await request('/v1/banks');
        await request('/v1/banks/rename', { apply: true, version: catalog.version, renames: [{ key, title: '端點測試｜新標題' }] });
        const saved = await request(bankPath);
        assert.equal(saved.bank.title, '端點測試｜新標題');
        assert.equal(saved.bank.storageKey, key);
        assert.equal(saved.questions[0].questionId, questionId);
        assert.equal(saved.questions[0].history[1].question, original.question);
        assert.equal((await assertSucceeds(get(ref(alice, `progress/agent-api-learner/quizzes/${key}/currentIndex`)))).val(), 1);
        assert.equal((await request('/v1/banks/import', { banks: [bank], apply: true })).banks[0].status, 'already_imported');

        const picture = await request('/v1/images', {
            contentType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2XkAAAAASUVORK5CYII=', apply: true
        });
        await assertSucceeds(get(ref(alice, picture.path)));
        await assertFails(get(ref(anon, picture.path)));
        console.log('Agent API passed against the Firebase Emulator: machine auth, import, edit with stable IDs, ETags, title changes, image rights and preserved learner progress.');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}
