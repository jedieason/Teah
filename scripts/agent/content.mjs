import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { bankTitle, validBankName } from '../../src/shared/banks.js';
import { isQuestionImage, validateQuiz } from '../../src/shared/content.js';
import { normalizeQuestion } from '../../src/features/learning/model.js';

export class AgentError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const bad = message => new AgentError(400, 'invalid_input', message);
const conflict = message => new AgentError(409, 'conflict', message);
const notFound = () => new AgentError(404, 'bank_not_found', '題庫不在目錄中。');
const questionFields = ['question', 'options', 'answer', 'explanation', 'origin', 'image', 'taxonomy', 'provenance'];
const removable = new Set(['options', 'image', 'taxonomy', 'provenance']);
const maxImageBytes = 512 * 1024;
const archived = key => key.startsWith('_Archive_');
const displayTitle = (key, catalog) => bankTitle(key, catalog).replace(/^_Archive_/, '');
const isRecord = value => !!value && Object.getPrototypeOf(value) === Object.prototype;
const hash = value => createHash('sha256').update(value).digest('hex');

function checkKeys(value, keys, path) {
    if (!isRecord(value)) throw bad(`${path} 必須是物件。`);
    for (const key of Object.keys(value)) if (!keys.includes(key)) throw bad(`${path}.${key} 不是可寫入的欄位。`);
}

function checkText(value, path, max = 100000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw bad(`${path} 必須是 1 至 ${max} 字的文字。`);
}

function checkList(value, max, path) {
    if (!Array.isArray(value) || !value.length || value.length > max) throw bad(`${path} 必須是包含 1 至 ${max} 筆資料的陣列。`);
}

function checkName(value, path, isTitle = false) {
    if (!validBankName(value) || value !== value.trim() || (isTitle && archived(value))) throw bad(`${path} 不是有效的題庫名稱或鍵。`);
}

function checkApply(body) {
    if (body.apply !== undefined && typeof body.apply !== 'boolean') throw bad('apply 必須是布林值。');
    return body.apply === true;
}

// Match Firebase's treatment of null children and empty collections. Sorting object keys
// makes a repeated import with equivalent JSON produce identical IDs and image references.
function stored(value) {
    if (Array.isArray(value)) return value.length ? value.map(stored) : null;
    if (!isRecord(value)) return value;
    const pairs = Object.keys(value).sort().map(key => [key, stored(value[key])]).filter(([, item]) => item != null);
    return pairs.length ? Object.fromEntries(pairs) : null;
}

function checkQuestionFields(fields, path) {
    checkKeys(fields, questionFields, path);
    for (const key of ['question', 'explanation', 'origin']) {
        if (Object.hasOwn(fields, key)) checkText(fields[key], `${path}.${key}`, key === 'origin' ? 2000 : undefined);
    }
    if (fields.options != null) {
        if (!isRecord(fields.options)) throw bad(`${path}.options 必須是選項物件。`);
        const labels = Object.keys(fields.options);
        if (labels.length < 2 || !(labels.length === 2 && labels.includes('T') && labels.includes('F')) && labels.some(label => !/^[A-L]$/.test(label))) {
            throw bad(`${path}.options 請使用 A–L 或 T、F。`);
        }
        for (const [label, text] of Object.entries(fields.options)) checkText(text, `${path}.options.${label}`);
    }
    if (Object.hasOwn(fields, 'answer')) {
        const answers = Array.isArray(fields.answer) ? fields.answer : [fields.answer];
        checkList(answers, 20, `${path}.answer`);
        for (const answer of answers) checkText(answer, `${path}.answer`, 8000);
        if (new Set(answers).size !== answers.length) throw bad(`${path}.answer 含有重複答案。`);
    }
    if (fields.image != null && !isQuestionImage(fields.image)) throw bad(`${path}.image 需要有效的 path 和 alt。`);
    for (const [key, names] of [['taxonomy', ['subject', 'system', 'topic', 'subtopic', 'competency', 'difficulty', 'year', 'tags']],
        ['provenance', ['source', 'page', 'questionNumber', 'references', 'status']]]) {
        const value = fields[key];
        if (value == null) continue;
        checkKeys(value, names, `${path}.${key}`);
        for (const [field, item] of Object.entries(value)) {
            const location = `${path}.${key}.${field}`;
            if (field === 'page') {
                if (!Number.isSafeInteger(item) || item < 1) throw bad(`${location} 必須是 PDF 頁碼的正整數。`);
            } else if (field === 'tags' || field === 'references') {
                checkList(item, 30, location);
                for (const text of item) checkText(text, location, 2000);
            } else checkText(item, location, 2000);
        }
    }
}

function checkQuiz(rows, path) {
    try { validateQuiz(rows); }
    catch (error) { throw bad(`${path}：${error.message}`); }
    for (const [index, q] of rows.entries()) {
        if (q.options && [].concat(q.answer).some(answer => !Object.hasOwn(q.options, answer))) throw bad(`${path}[${index}].answer 必須對應到原始選項鍵。`);
    }
}

function planImport(body) {
    checkKeys(body, ['apply', 'banks'], '請求');
    checkList(body.banks, 100, 'banks');
    const titles = new Set();
    return body.banks.map((bank, index) => {
        const path = `banks[${index}]`;
        checkKeys(bank, ['title', 'questions'], path);
        checkName(bank.title, `${path}.title`, true);
        if (titles.has(bank.title)) throw bad(`題庫名稱重複：${bank.title}`);
        titles.add(bank.title);
        checkList(bank.questions, 1000, `${path}.questions`);
        bank.questions.forEach((q, qIndex) => {
            const location = `${path}.questions[${qIndex}]`;
            checkQuestionFields(q, location);
            for (const key of ['question', 'explanation', 'origin']) checkText(q[key], `${location}.${key}`);
        });
        checkQuiz(bank.questions, `${path}.questions`);
        const fingerprint = hash(JSON.stringify(stored(bank)));
        const rows = bank.questions.map((q, i) => ({ ...stored(q), questionId: `q_${hash(`${fingerprint}:${i}`).slice(0, 40)}`, revision: 1 }));
        return { key: bank.title, rows, fingerprint };
    });
}

function imagePayload(body) {
    checkKeys(body, ['apply', 'contentType', 'base64'], '請求');
    const { contentType, base64 } = body;
    if (typeof base64 !== 'string' || !base64 || base64.length > 699052 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw bad('base64 必須為原始圖檔的 Base64，大小上限為 512 KiB。');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > maxImageBytes || bytes.toString('base64') !== base64) throw bad('圖片大小或 Base64 編碼不符。');
    const matches = (contentType === 'image/png' && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
        || (contentType === 'image/jpeg' && bytes.subarray(0, 3).toString('hex') === 'ffd8ff')
        || (contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
    if (!matches) throw bad('圖檔內容與宣告的 PNG、JPEG 或 WebP 格式不符。');
    return { path: `questionImages/img_${hash(bytes)}`, image: { contentType, base64 }, bytes: bytes.length };
}

export function createContentService(db, { now = Date.now } = {}) {
    async function readCatalog() {
        const snapshot = await db.read('quizCatalog');
        if (!isRecord(snapshot.value)) throw new AgentError(503, 'catalog_unavailable', '題庫目錄不存在或格式有誤。');
        return snapshot;
    }

    const banksIn = catalog => Object.keys(catalog).filter(validBankName);
    const identify = (key, catalog) => ({
        key, title: displayTitle(key, catalog), archived: archived(key),
        count: catalog[key]?.count ?? null, storageKey: catalog[key]?.storageKey || key.replace(/^_Archive_/, '')
    });

    async function readBank(key) {
        checkName(key, 'key');
        const { value: catalog } = await readCatalog();
        if (!Object.hasOwn(catalog, key)) throw notFound();
        const snapshot = await db.read(key);
        if (!Array.isArray(snapshot.value) || !snapshot.value.length || snapshot.value.some(q => !isRecord(q))) {
            throw new AgentError(409, 'invalid_bank', '題庫本體缺失或格式有誤。');
        }
        return { ...snapshot, bank: identify(key, catalog) };
    }

    async function checkImages(questions) {
        const paths = [...new Set(questions.map(q => q.image?.path).filter(Boolean))];
        for (let i = 0; i < paths.length; i += 8) {
            await Promise.all(paths.slice(i, i + 8).map(async path => {
                const { value } = await db.read(path);
                if (!value?.base64 || !value?.contentType) throw bad(`找不到題圖：${path}`);
            }));
        }
    }

    async function planNewBanks(plans, catalog) {
        const registrations = new Map(banksIn(catalog).filter(key => catalog[key]?.agentImport).map(key => [catalog[key].agentImport, key]));
        const activeTitles = new Set(banksIn(catalog).filter(key => !archived(key)).map(key => displayTitle(key, catalog)));
        const prepared = [];
        for (const plan of plans) {
            if (registrations.has(plan.fingerprint)) {
                prepared.push({ plan, existing: registrations.get(plan.fingerprint) });
                continue;
            }
            if (Object.hasOwn(catalog, plan.key) || activeTitles.has(plan.key)) throw conflict(`已有同名題庫：${plan.key}`);
            const { value, version } = await db.read(plan.key);
            if (value !== null && !isDeepStrictEqual(stored(value), stored(plan.rows))) throw conflict(`題庫路徑已有資料：${plan.key}`);
            prepared.push({ plan, version, staged: value !== null });
        }
        return prepared;
    }

    return {
        async list() {
            const { value, version } = await readCatalog();
            return { version, banks: banksIn(value).map(key => identify(key, value)) };
        },
        async get(key) {
            const { bank, value, version } = await readBank(key);
            return { bank, version, questions: value.map((q, i) => normalizeQuestion(q, key, i)) };
        },
        async import(body) {
            const plans = planImport(body);
            const apply = checkApply(body);
            const { value: catalog, version } = await readCatalog();
            const prepared = await planNewBanks(plans, catalog);
            await checkImages(prepared.filter(item => !item.existing).flatMap(({ plan }) => plan.rows));
            const nextCatalog = { ...catalog };
            const fresh = prepared.filter(item => !item.existing);
            if (apply && fresh.length) {
                for (const { plan, version: bankVersion, staged } of fresh) {
                    if (!staged) await db.put(plan.key, plan.rows, bankVersion);
                    nextCatalog[plan.key] = { count: plan.rows.length, storageKey: plan.key, agentImport: plan.fingerprint };
                }
                delete nextCatalog.__empty;
                await db.put('quizCatalog', nextCatalog, version);
            }
            return { applied: apply, banks: prepared.map(({ plan, existing }) => ({
                key: existing || plan.key,
                count: existing ? catalog[existing]?.count ?? plan.rows.length : plan.rows.length,
                status: existing ? 'already_imported' : apply ? 'created' : 'ready'
            })) };
        },
        async edit(body) {
            checkKeys(body, ['apply', 'key', 'version', 'edits'], '請求');
            const apply = checkApply(body);
            checkText(body.version, 'version', 200);
            checkList(body.edits, 1000, 'edits');
            const { value: rows, version } = await readBank(body.key);
            if (version !== body.version) throw conflict('題庫已更新，請重新讀取和核對。');
            const ids = rows.map((q, i) => normalizeQuestion(q, body.key, i).questionId);
            if (new Set(ids).size !== ids.length) throw conflict('題庫包含重複的題目 ID。');
            const indexById = new Map(ids.map((id, i) => [id, i]));
            const seen = new Set(), changes = [], imageChecks = [];
            for (const [editIndex, entry] of body.edits.entries()) {
                const path = `edits[${editIndex}]`;
                checkKeys(entry, ['questionId', 'set', 'reason'], path);
                checkText(entry.reason, `${path}.reason`, 1000);
                checkQuestionFields(entry.set, `${path}.set`);
                const index = indexById.get(entry.questionId);
                if (index === undefined || seen.has(entry.questionId)) throw bad(`${path}.questionId 不存在或重複。`);
                seen.add(entry.questionId);
                if (!Object.keys(entry.set).length) throw bad(`${path}.set 沒有提供修改欄位。`);
                const old = rows[index];
                const changeset = Object.entries(entry.set).filter(([field, value]) => !isDeepStrictEqual(stored(old[field]) ?? null, stored(value) ?? null));
                if (!changeset.length) continue;
                const revision = old.revision ?? 1;
                if (!Number.isSafeInteger(revision) || revision < 1 || revision === Number.MAX_SAFE_INTEGER) throw conflict('題目版本無法遞增。');
                const next = { ...old, questionId: entry.questionId, revision: revision + 1 };
                const previous = { reason: entry.reason, revisedAt: now() };
                for (const [field, value] of changeset) {
                    if (Object.hasOwn(old, field)) previous[field] = old[field];
                    if (value === null && removable.has(field)) delete next[field];
                    else next[field] = value;
                }
                checkQuiz([next], path);
                next.history = { ...old.history, [revision]: previous };
                rows[index] = next;
                if (Object.hasOwn(entry.set, 'image')) imageChecks.push(next);
                changes.push({ questionId: entry.questionId, previousRevision: revision, revision: next.revision, fields: changeset.map(([field]) => field) });
            }
            await checkImages(imageChecks);
            if (apply && changes.length) await db.put(body.key, rows, version);
            return { applied: apply, key: body.key, changes };
        },
        async rename(body) {
            checkKeys(body, ['apply', 'version', 'renames'], '請求');
            const apply = checkApply(body);
            checkText(body.version, 'version', 200);
            checkList(body.renames, 500, 'renames');
            const { value: catalog, version } = await readCatalog();
            if (version !== body.version) throw conflict('題庫目錄已更新，請重新取得目錄版本。');
            const changes = new Map();
            for (const entry of body.renames) {
                checkKeys(entry, ['key', 'title'], 'renames[]');
                checkName(entry.key, 'key');
                checkName(entry.title, 'title', true);
                if (!Object.hasOwn(catalog, entry.key)) throw notFound();
                if (changes.has(entry.key)) throw bad('同一份題庫不可重複改名。');
                changes.set(entry.key, entry.title);
            }
            const wanted = new Set();
            for (const key of banksIn(catalog)) {
                const title = changes.get(key) || displayTitle(key, catalog);
                const id = `${archived(key) ? 'archive' : 'active'}:${title}`;
                if (wanted.has(id) && (changes.has(key) || [...changes].some(([changed, value]) => archived(changed) === archived(key) && value === title))) throw conflict(`改名後有重複的題庫名稱：${title}`);
                wanted.add(id);
            }
            const updated = [...changes].filter(([key, title]) => title !== displayTitle(key, catalog));
            if (apply && updated.length) {
                const next = { ...catalog };
                for (const [key, title] of updated) {
                    next[key] = { ...catalog[key] };
                    if (title === displayTitle(key)) delete next[key].title;
                    else next[key].title = title;
                }
                await db.put('quizCatalog', next, version);
            }
            return { applied: apply, changes: updated.map(([key, title]) => ({ key, previousTitle: displayTitle(key, catalog), title })) };
        },
        async image(body) {
            const { path, image, bytes } = imagePayload(body);
            const apply = checkApply(body);
            const { value, version } = await db.read(path);
            if (value !== null && !isDeepStrictEqual(value, image)) throw conflict('此圖片路徑已存在不同內容。');
            if (apply && value === null) await db.put(path, image, version);
            return { applied: apply, path, bytes, exists: apply || value !== null };
        }
    };
}
