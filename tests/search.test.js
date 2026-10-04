import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuestionIndex, normalizeSearchText } from '../src/features/search/model.js';
import { createSearchLoader } from '../src/features/search/loader.js';

const q = (question, options = {}, explanation = 'explanation-only') => ({ question, options, answer: 'A', explanation });
test('substring search covers stems and individual options, with isolated archive scope and stable ranking', () => {
    const index = createQuestionIndex();
    index.replaceBank('病理｜B10', [q('細胞受體', { A: 'Acetylcholine receptor', B: '鈉離子' }), q('受體表現'), q('abc', { A: 'bcd' })]);
    index.replaceBank('_Archive_病理｜B09', [q('細胞受體')]);
    assert.equal(index.search('胞').length, 1);
    assert.equal(index.search('受體').length, 2);
    assert.deepEqual(index.search('CHOLINE')[0].fields, ['A']);
    assert.equal(index.search('細胞', { archived: true }).length, 1);
    assert.equal(index.search('abcd').length, 0, 'grams distributed across fields must not match');
    assert.equal(index.search('explanation-only').length, 0);
    assert.equal(index.search('B10').length, 0);
    index.replaceBank('藥理｜B11', [q('沒有命中的題幹', { A: '受體' })]);
    assert.deepEqual(index.search('受體').map(result => result.fields), [['question'], ['question'], ['A']]);
});

test('normalization handles width, case, whitespace, composed accents and supplementary characters', () => {
    const index = createQuestionIndex();
    index.replaceBank('題庫', [q('ＡＢＣ café\n  receptor 𠮷細胞', { A: 'pH < 6.5' })]);
    for (const query of ['abc', 'ＣＡＦÉ', 'cafe\u0301', 'café receptor', '𠮷', '𠮷細', '𠮷細胞', 'PH < 6.5']) assert.equal(index.search(query).length, 1, query);
    assert.equal(index.search('   ').length, 0);
});

test('replacing/removing banks discards stale postings, without deduplicating identical stems', () => {
    const index = createQuestionIndex();
    index.replaceBank('題庫', [q('舊資料'), q('舊資料')]);
    assert.equal(index.search('舊資料').length, 2);
    index.replaceBank('題庫', [q('新資料')]);
    assert.equal(index.size, 1); assert.equal(index.search('舊').length, 0);
    index.removeBank('題庫'); assert.equal(index.size, 0); assert.deepEqual(index.search('新'), []);
});

test('indexed results agree with exhaustive substring matching on mixed language and punctuation queries', () => {
    const index = createQuestionIndex(), rows = [];
    let seed = 451;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const alphabet = Array.from('細胞受體abcＡＢＣ𠮷 <.5');
    const text = () => Array.from({ length: 40 }, () => alphabet[random() % alphabet.length]).join('');
    for (let i = 0; i < 160; i++) rows.push(q(text(), { A: text(), B: text() }));
    index.replaceBank('題庫', rows);
    const queries = ['細', '胞受', 'abc', 'ABC', '5 <', '<.5', '𠮷', '無', '受體', 'a b'];
    for (const row of rows.slice(0, 30)) queries.push(Array.from(row.options.B).slice(3, 10).join(''));
    for (const query of queries) {
        const normalized = normalizeSearchText(query);
        const expected = rows.flatMap((row, i) => [row.question, ...Object.values(row.options)].some(field => normalizeSearchText(field).includes(normalized)) ? [i] : []);
        assert.deepEqual(index.search(query).map(result => result.question.originalIndex).sort((a, b) => a - b), expected, query);
    }
});

test('loader reads only the requested scope, caps concurrency, reuses successful banks and retries failures', async () => {
    const calls = []; let active = 0, maximum = 0, fail = true;
    const loader = createSearchLoader({ readBank: async path => {
        calls.push(path); maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 1)); active--;
        if (path === 'bank5' && fail) throw new Error('permission denied');
        return [q('needle')];
    }, yieldTask: async () => {} });
    loader.resetForUser('one'); loader.setCatalog(Object.fromEntries([...Array.from({ length: 6 }, (_, i) => `bank${i}`), '_Archive_old'].map(path => [path, {}])));
    const [first, same] = await Promise.all([loader.load(false), loader.load(false)]);
    assert.equal(first.index, same.index); assert.equal(calls.length, 6); assert.ok(maximum <= 4);
    assert.deepEqual(first.failures, ['bank5']); assert.equal(first.index.search('needle').length, 5);
    fail = false; const retried = await loader.load(false);
    assert.equal(calls.length, 7); assert.equal(retried.index.search('needle').length, 6);
    await loader.load(false); assert.equal(calls.length, 7);
    assert.equal((await loader.load(true)).index.search('needle', { archived: true }).length, 1);
    assert.equal(calls.at(-1), '_Archive_old');
});

test('owner/catalog changes invalidate pending loads and stale results', async () => {
    const pending = [];
    const loader = createSearchLoader({ readBank: path => new Promise(resolve => pending.push({ path, resolve })), yieldTask: async () => {} });
    loader.resetForUser('one'); loader.setCatalog({ old: {} });
    const old = loader.load(false); loader.resetForUser('two');
    pending.shift().resolve([q('secret')]); assert.equal(await old, null);
    loader.setCatalog({ new: {} }); const current = loader.load(false);
    assert.equal(pending[0].path, 'new'); pending.shift().resolve([q('current')]);
    assert.equal((await current).index.search('secret').length, 0);
    const stale = loader.load(true); loader.setCatalog({}); assert.equal(await stale, null);
    loader.resetForUser(null); assert.equal(await loader.load(false), null);
});
