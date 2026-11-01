import { overview, section, empty, metric, progress } from './panels.js';
import { diagnosticReport } from '../../services/diagnostics.js';
import { auth, database, ref, get, set, update, signOut, deleteUser, reauthenticateWithPopup, googleProvider } from '../../services/firebase.js';
import { learningState, loadLearning, savePreference } from '../../services/learning.js';
import { storage, clearAccountCache, suspendAccount, resumeAccount } from '../../services/outbox.js';
const el = (tag, text, parent) => { const node = document.createElement(tag); if (text != null) node.textContent = text; parent?.append(node); return node; };
const button = (text, parent, action, className = 'secondary-button') => { const b = el('button', text, parent); b.type = 'button'; b.className = className; b.onclick = async () => { b.disabled = true; try { await action(); } catch (e) { window.alert(e.message || '操作失敗，請重試。'); } finally { b.disabled = false; } }; return b; };
const download = (value, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export function mountLearningHub({ host, activate, onNavigateHome, alert, current } = {}) {
    const sync = el('p', '', document.querySelector('.home-content')); sync.className = 'sync-status'; sync.setAttribute('role', 'status');
    window.addEventListener('sync-status', ({ detail }) => { sync.textContent = detail.error ? '資料已保存在此裝置，尚未同步；連線後會重試。' : detail.pending ? `${detail.pending} 筆紀錄等待同步` : ''; });
    const dialog = el('dialog', null, document.body); dialog.className = 'learning-dialog';
    const open = title => { dialog.classList.toggle('learning-panel', ['資料與隱私', '內容回報進度'].includes(title)); dialog.setAttribute('aria-label', title); dialog.replaceChildren(); const header = el('div', null, dialog); header.className = 'learning-header'; el('h2', title, header); button('關閉', header, () => dialog.close(), 'secondary-button'); dialog.showModal(); const body = el('div', null, dialog); body.className = 'panel-body'; return body; };
    const requireUser = () => { if (!auth.currentUser) { alert?.('請先登入以使用學習紀錄。'); return false; } return true; };

    const renderPage = () => {
        if (!host) return;
        host.replaceChildren();
        const heading = el('header', null, host);
        heading.className = 'learning-page-heading';
        const titleGroup = el('div', null, heading);
        el('h2', '學習總覽', titleGroup);
        const actions = el('div', null, heading);
        button('返回題庫', actions, () => onNavigateHome?.(), 'secondary-button');

        const body = el('div', null, host);
        body.className = 'panel-body';

        if (!auth.currentUser) {
            empty(body, '尚未登入', '請先登入 Google 帳號以記錄作答進度與查看學習統計。');
            return;
        }
        overview(body, learningState, Date.now());
    };

    const openLearning = async () => {
        if (!requireUser()) {
            renderPage();
            activate?.();
            return;
        }
        await loadLearning();
        renderPage();
        activate?.();
    };
    const openPrivacy = async () => {
        const body = open('資料與隱私');
        const dataCard = section(body, '學習資料');
        const policy = el('a', '完整資料政策與使用條款', dataCard); policy.href = 'privacy.html'; policy.target = '_blank'; policy.rel = 'noopener';
        el('p', '題矣保存 Google 登入識別、進度、作答事件、錯題、收藏、Flashcard 字卡集及個人筆記，供跨裝置學習使用。資料保留至你主動刪除；此裝置另有離線副本。', dataCard);
        const aiCard = section(body, 'AI 與使用條款');
        el('p', 'AI 功能會將你選擇的題目、作答及輸入內容傳送至 Google Gemini。請勿輸入病人或其他個人敏感資料。AI 內容可能有誤，應回查原始教材。', aiCard);
        const analyticsCard = section(body, '使用量與診斷');
        const isAnalyticsEnabled = () => { try { return localStorage.getItem('teah-analytics-consent') !== 'no'; } catch { return true; } };
        const consent = el('span', isAnalyticsEnabled() ? '分析已啟用' : '分析已停用', analyticsCard); consent.className = 'panel-badge';
        el('p', '使用量分析預設啟用。你可自行開啟或撤回同意；此裝置只保留最近 100 筆不含題目、答案或 API 金鑰的錯誤及同步診斷。', analyticsCard);
        el('p', '使用條款：本服務供學習用途，不提供診斷或治療建議。題庫來源與權利仍屬原作者，請只上傳有權使用的內容。', aiCard);
        const danger = section(body, '刪除帳戶與資料'); danger.classList.add('panel-danger');
        el('p', '刪除學習資料會清除本服務的雲端紀錄及此瀏覽器離線副本；其他裝置應登出並清除網站資料。Google 帳戶本身不受影響。', danger);
        button('匯出此裝置診斷紀錄', analyticsCard, () => download(diagnosticReport(), 'teah-diagnostics.json'), 'secondary-button');
        button('匯出我的資料', dataCard, async () => {
            if (!requireUser()) return; const uid = auth.currentUser.uid, data = {};
            for (const key of ['progress', 'mistakes', 'learning', 'feedback', 'flashcard']) data[key] = (await get(ref(database, `${key}/${uid}`))).val();
            data.pending = (await storage('outbox', 'getAll')).filter(i => i.uid === uid);
            download(data, 'teah-my-data.json');
        }, 'secondary-button');
        button('刪除帳戶與全部學習資料', danger, async () => {
            if (!requireUser() || !window.confirm('將永久刪除此服務帳戶、全部學習紀錄、筆記、收藏與 Flashcard 字卡集。建議先匯出；確定刪除？')) return;
            const user = auth.currentUser, uid = user.uid;
            await reauthenticateWithPopup(user, googleProvider);
            await suspendAccount(uid);
            try {
                await update(ref(database), { [`progress/${uid}`]: null, [`mistakes/${uid}`]: null, [`learning/${uid}`]: null, [`feedback/${uid}`]: null, [`flashcard/${uid}`]: null });
                await clearAccountCache(uid);
                await deleteUser(user);
                location.reload();
            } catch (error) { resumeAccount(uid); throw error; }
        }, 'secondary-button panel-danger-btn');
        button('允許使用量分析', analyticsCard, () => {
            const wasDisabled = !isAnalyticsEnabled();
            try { localStorage.setItem('teah-analytics-consent', 'yes'); } catch {}
            consent.textContent = wasDisabled ? '分析已啟用 · 下次載入生效' : '分析已啟用';
        }, 'secondary-button');
        button('停用使用量分析', analyticsCard, () => { try { localStorage.setItem('teah-analytics-consent', 'no'); } catch {} location.reload(); }, 'secondary-button');
    };
    const menuPrivacy = document.getElementById('menuPrivacy');
    if (menuPrivacy) menuPrivacy.onclick = () => { void openPrivacy(); };
    const openFeedback = async () => {
        if (!requireUser()) return;
        const body = open('內容回報進度');
        const rows = (await get(ref(database, `feedback/${auth.currentUser.uid}`))).val() || {};
        const metrics = el('div', null, body); metrics.className = 'panel-metrics';
        metric(metrics, '全部回報', Object.keys(rows).length);
        metric(metrics, '待處理', Object.values(rows).filter(t => t.status !== 'resolved').length);
        metric(metrics, '已處理', Object.values(rows).filter(t => t.status === 'resolved').length);
        if (!Object.keys(rows).length) empty(body, '尚無回報');
        for (const ticket of Object.values(rows).sort((a, b) => b.createdAt - a.createdAt)) {
            const card = section(body, ticket.reason);
            const badge = el('span', ticket.status === 'resolved' ? '已處理' : '待處理', card); badge.className = `panel-badge ${ticket.status === 'resolved' ? 'is-success' : 'is-review'}`;
            el('p', new Date(ticket.createdAt).toLocaleDateString(), card).className = 'panel-muted';
            if (ticket.resolution) el('p', ticket.resolution, card).className = 'panel-resolution';
        }
    };
    const menuFeedback = document.getElementById('menuFeedback');
    if (menuFeedback) menuFeedback.onclick = () => { void openFeedback(); };
    const questionActions = document.querySelector('.explanation-buttons > .header-right');
    const asIcon = (node, label, paths) => {
        node.className = 'action-icon-btn question-note';
        node.setAttribute('aria-label', label); node.title = label;
        node.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    };
    const report = button('回報內容問題', questionActions, async () => {
        if (!requireUser()) return; const q = current(); if (!q?.questionId) return;
        const body = open('回報內容問題'); const text = el('textarea', null, body); text.rows = 5; text.maxLength = 2000; text.placeholder = '請說明答案、詳解、來源或顯示問題';
        const actions = el('div', null, body); actions.className = 'dialog-actions';
        button('送出回報', actions, async () => {
            if (!text.value.trim()) return;
            await set(ref(database, `feedback/${auth.currentUser.uid}/${crypto.randomUUID()}`), { questionId: q.questionId, questionRevision: q.revision || 1, reason: text.value.trim(), status: 'open', createdAt: Date.now() });
            dialog.close(); alert('回報已送出，可在「我的回報」查看處理結果。');
        }, 'primary-button');
    }); asIcon(report, '回報內容問題', '<path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>');
    report.style.display = 'none';
    const notes = button('個人筆記', questionActions, async () => {
        if (!requireUser()) return; const q = current(); if (!q?.questionId) { alert('請重新載入題庫後使用筆記。'); return; }
        const selectedText = window.getSelection()?.toString().slice(0, 2000) || '';
        const body = open('題目筆記'); const input = el('textarea', null, body); input.rows = 8; input.maxLength = 10000; input.value = learningState[`note_${q.questionId}`]?.text || '';
        const actions = el('div', null, body); actions.className = 'dialog-actions';
        if (selectedText) button('加入選取的文字', actions, () => { input.value += `\n> ${selectedText}\n`; }, 'secondary-button');
        button('儲存筆記', actions, async () => { await savePreference(`note_${q.questionId}`, { text: input.value, questionId: q.questionId }); dialog.close(); }, 'primary-button');
    }); asIcon(notes, '個人筆記', '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6M10 16h4"/>');

    return { open: openLearning, render: renderPage };
}
