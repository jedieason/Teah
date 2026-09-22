import { section, empty, node } from './panels.js';
import { auth, database, ref, get, set, update, runTransaction } from '../../services/firebase.js';
import { validateQuiz } from '../../shared/content.js';
import { normalizeQuestion } from './model.js';
export function mountEditorial() {
    const launch = document.createElement('button'); launch.className = 'quiet-button'; launch.textContent = '內容工作台';
    document.querySelector('.library-shortcuts').append(launch);
    launch.onclick = async () => {
        const claims = (await auth.currentUser?.getIdTokenResult?.())?.claims || {};
        if (!['admin', 'editor', 'reviewer', 'contributor'].some(r => claims[r])) { window.alert('此功能需要內容維護角色。請由管理員設定帳戶權限。'); return; }
        const dialog = document.createElement('dialog'); dialog.className = 'learning-dialog learning-panel'; dialog.setAttribute('aria-label', '內容工作台'); document.body.append(dialog);
        const body = node('div', null, dialog, 'panel-body');
        const add = (tag, text, parent = body) => { const n = document.createElement(tag); if (text) n.textContent = text; parent.append(n); return n; };
        const action = (label, callback, parent = body) => { const b = add('button', label, parent); b.className = 'quiet-button'; b.onclick = async () => { b.disabled = true; try { await callback(); } catch (e) { status.textContent = e.message; } finally { b.disabled = false; } }; return b; };
        const header = node('div', null, null, 'learning-header'); dialog.prepend(header);
        add('h2', '內容工作台', header); action('關閉', () => { dialog.close(); dialog.remove(); }, header);
        const workflow = node('div', null, body, 'panel-workflow');
        for (const step of ['1 建立草稿', '2 獨立審核', '3 管理員發佈']) node('span', step, workflow, 'panel-badge');
        add('p', '新內容先送審，再由不同維護者核准，最後由管理員發佈。請在題目 provenance 中提供來源、頁碼及參考資料；taxonomy 可標註科目、系統、主題、難度與年份。');
        const draftForm = section(body, '新增內容草稿');
        const nameLabel = node('label', '題庫名稱', draftForm, 'panel-field');
        const name = add('input', '', nameLabel); name.placeholder = '題庫名稱'; name.setAttribute('aria-label', '題庫名稱');
        const contentLabel = node('label', '題目內容', draftForm, 'panel-field');
        const input = add('textarea', '', contentLabel); input.rows = 10; input.placeholder = '貼上題目 JSON 陣列'; input.setAttribute('aria-label', '題目 JSON');
        const status = add('p'); status.setAttribute('role', 'status');
        action('建立草稿', async () => {
            const bank = name.value.trim(); if (!bank || /[.#$\[\]/]/.test(bank)) throw new Error('請使用有效的題庫名稱。');
            const questions = validateQuiz(JSON.parse(input.value)).map((q, i) => normalizeQuestion({ ...q, questionId: q.questionId || `q_${crypto.randomUUID()}` }, bank, i));
            const id = crypto.randomUUID();
            await set(ref(database, `contentDrafts/${id}`), { bank, questionsJson: JSON.stringify(questions), status: 'draft', author: auth.currentUser.uid, createdAt: Date.now() });
            status.textContent = '草稿已建立。'; await refresh();
        }, draftForm);
        const list = add('div'); list.className = 'panel-drafts';
        async function refresh() {
            const rows = (await get(ref(database, 'contentDrafts'))).val() || {}; list.replaceChildren();
            if (!Object.keys(rows).length) empty(list, '尚無內容草稿');
            for (const [id, draft] of Object.entries(rows)) {
                draft.questions = JSON.parse(draft.questionsJson);
                const card = section(list, draft.bank); node('span', ({ draft: '草稿', review: '待審核', approved: '已核准', published: '已發佈' })[draft.status] || draft.status, card, 'panel-badge');
                add('p', `${draft.questions.length} 題 · ${new Date(draft.createdAt).toLocaleString()}`, card);
                const details = add('details', '', card); add('summary', '檢視題目、答案與來源', details); const preview = add('pre', JSON.stringify(draft.questions, null, 2), details); preview.style.whiteSpace = 'pre-wrap';
                if (draft.status === 'draft' && (draft.author === auth.currentUser.uid || claims.admin)) action('送交審核', async () => {
                    await update(ref(database, `contentDrafts/${id}`), { status: 'review', submittedAt: Date.now() }); await refresh();
                }, card);
                if (draft.status === 'review' && (claims.reviewer || claims.admin) && draft.author !== auth.currentUser.uid) action('核准內容', async () => {
                    await update(ref(database, `contentDrafts/${id}`), { status: 'approved', reviewer: auth.currentUser.uid, reviewedAt: Date.now() }); await refresh();
                }, card);
                if (draft.status === 'approved' && claims.admin) action('發佈題庫', async () => {
                    const current = (await get(ref(database, draft.bank))).val();
                    if (current && !window.confirm('將更新現有題庫，舊版本會保存在發佈紀錄中。確定繼續？')) return;
                    const byId = new Map((current || []).map(q => [q.questionId, q]));
                    const questions = draft.questions.map(q => ({ ...q, revision: byId.has(q.questionId) ? (byId.get(q.questionId).revision || 1) + 1 : q.revision,
                        provenance: { ...q.provenance, status: 'published', reviewer: draft.reviewer, reviewedAt: draft.reviewedAt } }));
                    const auditId = crypto.randomUUID();
                    const catalogEntry = (await get(ref(database, `quizCatalog/${draft.bank}`))).val() || {};
                    await update(ref(database), { [draft.bank]: questions, [`quizCatalog/${draft.bank}`]: { ...catalogEntry, count: questions.length, schemaVersion: 3, storageKey: catalogEntry.storageKey || draft.bank },
                        [`contentDrafts/${id}/status`]: 'published', [`auditLog/${auditId}`]: { bank: draft.bank, action: 'publish', actor: auth.currentUser.uid, at: Date.now(), previous: current || [], draftId: id } });
                    status.textContent = '已發佈。重新整理首頁可看見題庫。'; await refresh();
                }, card);
            }
            if (claims.admin || claims.reviewer) {
                add('h3', '使用者回報', list);
                const feedback = (await get(ref(database, 'feedback'))).val() || {};
                for (const [uid, tickets] of Object.entries(feedback)) for (const [ticketId, ticket] of Object.entries(tickets)) {
                    if (ticket.status === 'resolved') continue;
                    add('p', `${ticket.questionId} · ${ticket.reason}`, list);
                    action('回覆並標示已處理', async () => {
                        const resolution = window.prompt('處理結果或說明'); if (!resolution?.trim()) return;
                        await update(ref(database, `feedback/${uid}/${ticketId}`), { status: 'resolved', resolution: resolution.trim(), reviewer: auth.currentUser.uid, resolvedAt: Date.now() }); await refresh();
                    }, list);
                }
            }
            if (claims.admin) {
                add('h3', '發佈與回復紀錄', list);
                const logs = (await get(ref(database, 'auditLog'))).val() || {};
                for (const [id, log] of Object.entries(logs).sort((a, b) => b[1].at - a[1].at).slice(0, 20)) {
                    add('p', `${log.bank} · ${log.action} · ${new Date(log.at).toLocaleString()}`, list);
                    if (log.previous?.length) action('將此前版本建立為新草稿', async () => {
                        await set(ref(database, `contentDrafts/${crypto.randomUUID()}`), { bank: log.bank, questionsJson: JSON.stringify(log.previous), status: 'draft', author: auth.currentUser.uid, createdAt: Date.now(), rollbackOf: id });
                        status.textContent = '回復草稿已建立，仍需審核後發佈。'; await refresh();
                    }, list);
                }
            }
        }
        dialog.showModal(); try { await refresh(); } catch (e) { status.textContent = e.message; }
    };
}
