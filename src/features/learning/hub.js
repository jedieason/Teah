import { overview, section, empty, metric, progress } from './panels.js';
import { diagnosticReport } from '../../services/diagnostics.js';
import { auth, database, ref, get, set, update, signOut, deleteUser, reauthenticateWithPopup, googleProvider } from '../../services/firebase.js';
import { learningState, loadLearning, readBank, savePreference } from '../../services/learning.js';
import { storage, clearAccountCache, suspendAccount, resumeAccount } from '../../services/outbox.js';
import { selectQuestions, summarize, DAY } from './model.js';
const el = (tag, text, parent) => { const node = document.createElement(tag); if (text != null) node.textContent = text; parent?.append(node); return node; };
const button = (text, parent, action) => { const b = el('button', text, parent); b.type = 'button'; b.className = 'quiet-button'; b.onclick = async () => { b.disabled = true; try { await action(); } catch (e) { window.alert(e.message || '操作失敗，請重試。'); } finally { b.disabled = false; } }; return b; };
const download = (value, name) => { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
export function mountLearningHub({ getCatalog, alert, current, start, openCards }) {
    const nav = document.querySelector('.library-shortcuts');
    const sync = el('p', '', document.querySelector('.home-content')); sync.className = 'sync-status'; sync.setAttribute('role', 'status');
    window.addEventListener('sync-status', ({ detail }) => { sync.textContent = detail.error ? '資料已保存在此裝置，尚未同步；連線後會重試。' : detail.pending ? `${detail.pending} 筆紀錄等待同步` : '學習紀錄已同步'; });
    const dialog = el('dialog', null, document.body); dialog.className = 'learning-dialog';
    const open = title => { dialog.classList.toggle('learning-panel', ['學習總覽', '組一場測驗', '資料與隱私', '內容回報進度'].includes(title)); dialog.setAttribute('aria-label', title); dialog.replaceChildren(); const header = el('div', null, dialog); header.className = 'learning-header'; el('h2', title, header); button('關閉', header, () => dialog.close()); dialog.showModal(); const body = el('div', null, dialog); body.className = 'panel-body'; return body; };
    const requireUser = () => { if (!auth.currentUser) { alert('請先登入以使用學習紀錄。'); return false; } return true; };
    button('自訂測驗', nav, async () => {
        if (!requireUser()) return;
        const body = open('組一場測驗');
        const intro = section(body, '依你的步調練習', '先載入題庫，再選擇範圍、題數與作答方式。');
        const form = el('form', null, body); form.className = 'learning-form panel-card';
        const fields = {};
        const field = (name, label, options) => {
            const l = el('label', label, form), input = el(options ? 'select' : 'input', null, l); fields[name] = input;
            if (options) for (const [value, text] of options) { const o = el('option', text, input); o.value = value; }
            return input;
        };
        const banks = Object.keys(getCatalog()).filter(k => !k.startsWith('_Archive_'));
        const selected = field('bank', '題庫範圍', [['', '全部題庫'], ...banks.map(k => [k, k])]);
        field('query', '搜尋題目或標籤');
        for (const [key, title] of [['subject', '科目'], ['system', '系統'], ['topic', '主題'], ['difficulty', '難度'], ['year', '年份']]) field(key, title, [['', '全部']]);
        field('status', '作答狀態', [['all', '全部'], ['new', '未作答'], ['wrong', '最近答錯'], ['due', '到期複習'], ['starred', '已收藏']]);
        const count = field('count', '題數（最多 200）'); count.type = 'number'; count.min = 1; count.max = 200; count.value = 20;
        field('order', '選題方式', [['adaptive', '優先到期與弱項'], ['random', '隨機'], ['original', '原始順序']]);
        field('shuffleOptions', '選項順序', [['no', '原始順序'], ['yes', '隨機']]);
        field('timeLimit', '每題提醒', [['0', '不設提醒'], ['30', '30 秒'], ['60', '60 秒'], ['90', '90 秒']]);
        field('mode', '作答模式', [['study', '學習：逐題回饋'], ['exam', '考試：交卷後統一回饋']]);
        const status = el('p', '先載入題目，再依分類組題。未標註分類的題目只出現在「全部」。', body); status.setAttribute('role', 'status');
        let items = [], loaded = false;
        selected.onchange = () => { loaded = false; items = []; status.textContent = '範圍已變更，請重新載入。'; };
        const loadButton = button('載入題目', body, async () => {
            const uid = auth.currentUser.uid, scope = selected.value;
            const keys = scope ? [scope] : banks;
            const stars = (await get(ref(database, `progress/${uid}/starred`))).val() || [];
            items = []; loaded = false;
            for (const key of keys) {
                const rows = await readBank(key);
                if (uid !== auth.currentUser?.uid) throw new Error('帳戶已切換，請重新開啟。');
                items.push(...rows.map((q, i) => ({ ...q, originalIndex: i, sourcePath: key,
                    starred: Object.values(stars).some(s => s.questionId === q.questionId || s.question === q.question && s.source === key) })));
                status.textContent = `已載入 ${items.length} 題…`;
            }
            if (scope !== selected.value) { items = []; throw new Error('範圍已變更，請重新載入。'); }
            for (const key of ['subject', 'system', 'topic', 'difficulty', 'year']) {
                fields[key].replaceChildren();
                for (const value of ['', ...new Set(items.map(q => q.taxonomy[key]).filter(Boolean))]) { const o = el('option', value || '全部', fields[key]); o.value = value; }
            }
            loaded = true; status.textContent = `可組題 ${items.length} 題。分類資料未經人工補註時，不會推測醫學主題或難度。`;
        });
        intro.append(status, loadButton);
        const submit = el('button', '開始測驗', form); submit.type = 'submit'; submit.className = 'primary-button';
        form.onsubmit = async event => {
            event.preventDefault(); if (!loaded) { status.textContent = '請先載入題目。'; return; }
            const filters = Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, input.value]));
            const chosen = selectQuestions(items, filters, learningState);
            if (!chosen.length) { status.textContent = '沒有符合條件的題目，請調整篩選。'; return; }
            submit.disabled = true;
            try { await start(chosen, fields.mode.value, { shuffleOptions: fields.shuffleOptions.value === 'yes', timeLimit: Number(fields.timeLimit.value) }); dialog.close(); } catch (e) { status.textContent = e.message; } finally { submit.disabled = false; }
        };
    });
    button('學習總覽', nav, async () => {
        if (!requireUser()) return; await loadLearning(); const body = open('學習總覽'); const now = Date.now();
        overview(body, learningState, now);
        const plan = section(body, '讀書計畫', '設定考試日期與每日目標，讓練習有方向。');
        const planStatus = el('p', '', plan); planStatus.setAttribute('role', 'status');
        const planProgress = progress(plan, 0, 1, '今日目標完成進度'); planProgress.hidden = true;
        const form = el('form', null, plan); form.className = 'learning-form';
        const inputs = {};
        for (const [key, label, type] of [['title', '目標名稱', 'text'], ['examDate', '考試日期', 'date'], ['daily', '每日目標題數', 'number'], ['remaining', '剩餘待完成題數', 'number']]) {
            const input = el('input', null, el('label', label, form)); input.type = type; input.required = true; if (type === 'number') input.min = 1;
            input.value = learningState.plan?.[key] || ''; inputs[key] = input;
        }
        const save = el('button', '儲存計畫', form); save.type = 'submit'; save.className = 'primary-button';
        const describe = () => { const p = learningState.plan; if (p) { const days = Math.max(1, Math.ceil((new Date(p.examDate + 'T23:59:59') - now) / DAY)); const today = new Date(); today.setHours(0, 0, 0, 0); const n = summarize(learningState.attempts, +today).count; planStatus.textContent = `${p.title}：今日 ${n}/${p.daily} 題；剩 ${days} 天，依目前剩餘題數建議每日 ${Math.ceil(Number(p.remaining) / days)} 題。剩餘題數可隨進度更新。`; planProgress.hidden = false; planProgress.max = Math.max(1, Number(p.daily)); planProgress.value = n; planProgress.setAttribute('aria-label', `今日已完成 ${n} 題，目標 ${p.daily} 題`); } else { planStatus.textContent = '還沒有計畫，先為自己設定一個小目標。'; } };
        describe(); form.onsubmit = async e => { e.preventDefault(); try { await savePreference('plan', Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); describe(); } catch (error) { planStatus.textContent = error.message; } };
    });
    button('資料與隱私', nav, async () => {
        const body = open('資料與隱私');
        const dataCard = section(body, '你的學習資料', '跨裝置同步，也保留資料的掌控權。');
        const policy = el('a', '完整資料政策與使用條款', dataCard); policy.href = 'privacy.html'; policy.target = '_blank'; policy.rel = 'noopener';
        el('p', '題矣保存 Google 登入識別、進度、作答事件、錯題、收藏及個人筆記，供跨裝置學習使用。資料保留至你主動刪除；此裝置另有離線副本。', dataCard);
        const aiCard = section(body, 'AI 與使用條款');
        el('p', 'AI 功能會將你選擇的題目、作答及輸入內容傳送至 Google Gemini。請勿輸入病人或其他個人敏感資料。AI 內容可能有誤，應回查原始教材。', aiCard);
        const analyticsCard = section(body, '使用量與診斷');
        const consent = el('span', localStorage.getItem('teah-analytics-consent') === 'yes' ? '分析已啟用' : '分析已停用', analyticsCard); consent.className = 'panel-badge';
        el('p', '使用量分析預設停用。你可自行開啟或撤回同意；此裝置只保留最近 100 筆不含題目、答案或 API 金鑰的錯誤及同步診斷。', analyticsCard);
        el('p', '使用條款：本服務供學習用途，不提供診斷或治療建議。題庫來源與權利仍屬原作者，請只上傳有權使用的內容。', aiCard);
        const danger = section(body, '刪除帳戶與資料'); danger.classList.add('panel-danger');
        el('p', '刪除學習資料會清除本服務的雲端紀錄及此瀏覽器離線副本；其他裝置應登出並清除網站資料。Google 帳戶本身不受影響。', danger);
        button('匯出此裝置診斷紀錄', analyticsCard, () => download(diagnosticReport(), 'teah-diagnostics.json'));
        button('匯出我的資料', dataCard, async () => {
            if (!requireUser()) return; const uid = auth.currentUser.uid, data = {};
            for (const key of ['progress', 'mistakes', 'learning', 'feedback']) data[key] = (await get(ref(database, `${key}/${uid}`))).val();
            data.pending = (await storage('outbox', 'getAll')).filter(i => i.uid === uid);
            download(data, 'teah-my-data.json');
        });
        button('刪除帳戶與全部學習資料', danger, async () => {
            if (!requireUser() || !window.confirm('將永久刪除此服務帳戶、全部學習紀錄、筆記與收藏。建議先匯出；確定刪除？')) return;
            const user = auth.currentUser, uid = user.uid;
            await reauthenticateWithPopup(user, googleProvider);
            await suspendAccount(uid);
            try {
                await update(ref(database), { [`progress/${uid}`]: null, [`mistakes/${uid}`]: null, [`learning/${uid}`]: null, [`feedback/${uid}`]: null });
                await clearAccountCache(uid);
                await deleteUser(user);
                location.reload();
            } catch (error) { resumeAccount(uid); throw error; }
        });
        button('允許使用量分析', analyticsCard, () => { localStorage.setItem('teah-analytics-consent', 'yes'); consent.textContent = '分析已啟用 · 下次載入生效'; });
        button('停用使用量分析', analyticsCard, () => { localStorage.removeItem('teah-analytics-consent'); location.reload(); });
    });
    button('複習卡', nav, async () => { if (requireUser()) await openCards(); });
    button('我的回報', nav, async () => {
        if (!requireUser()) return;
        const body = open('內容回報進度');
        const rows = (await get(ref(database, `feedback/${auth.currentUser.uid}`))).val() || {};
        const metrics = el('div', null, body); metrics.className = 'panel-metrics';
        metric(metrics, '全部回報', Object.keys(rows).length, '你提交的內容問題');
        metric(metrics, '待處理', Object.values(rows).filter(t => t.status !== 'resolved').length, '等待內容維護者確認');
        metric(metrics, '已處理', Object.values(rows).filter(t => t.status === 'resolved').length, '查看下方處理結果');
        if (!Object.keys(rows).length) empty(body, '目前沒有回報', '遇到內容問題時，可由答題頁的回報按鈕提交。');
        for (const ticket of Object.values(rows).sort((a, b) => b.createdAt - a.createdAt)) {
            const card = section(body, ticket.reason);
            const badge = el('span', ticket.status === 'resolved' ? '已處理' : '待處理', card); badge.className = `panel-badge ${ticket.status === 'resolved' ? 'is-success' : 'is-review'}`;
            el('p', new Date(ticket.createdAt).toLocaleDateString(), card).className = 'panel-muted';
            if (ticket.resolution) el('p', ticket.resolution, card).className = 'panel-resolution';
        }
    });
    const questionActions = document.querySelector('.explanation-buttons > .header-right');
    const asIcon = (node, label, paths) => {
        node.className = 'action-icon-btn question-note';
        node.setAttribute('aria-label', label); node.title = label;
        node.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    };
    const report = button('回報內容問題', questionActions, async () => {
        if (!requireUser()) return; const q = current(); if (!q?.questionId) return;
        const body = open('回報內容問題'); const text = el('textarea', null, body); text.rows = 5; text.maxLength = 2000; text.placeholder = '請說明答案、詳解、來源或顯示問題';
        button('送出回報', body, async () => {
            if (!text.value.trim()) return;
            await set(ref(database, `feedback/${auth.currentUser.uid}/${crypto.randomUUID()}`), { questionId: q.questionId, questionRevision: q.revision || 1, reason: text.value.trim(), status: 'open', createdAt: Date.now() });
            dialog.close(); alert('回報已送出，可在「我的回報」查看處理結果。');
        });
    }); asIcon(report, '回報內容問題', '<path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>');
    const notes = button('個人筆記', questionActions, async () => {
        if (!requireUser()) return; const q = current(); if (!q?.questionId) { alert('請重新載入題庫後使用筆記。'); return; }
        const selectedText = window.getSelection()?.toString().slice(0, 2000) || '';
        const body = open('題目筆記'); const input = el('textarea', null, body); input.rows = 8; input.maxLength = 10000; input.value = learningState[`note_${q.questionId}`]?.text || '';
        if (selectedText) button('加入選取的文字', body, () => { input.value += `\n> ${selectedText}\n`; });
        button('以此筆記建立複習卡', body, async () => { if (!input.value.trim()) return; await savePreference(`card_${crypto.randomUUID()}`, { front: q.question, back: input.value, questionId: q.questionId, dueAt: Date.now(), intervalDays: 0 }); dialog.close(); });
        button('儲存筆記', body, async () => { await savePreference(`note_${q.questionId}`, { text: input.value, questionId: q.questionId }); dialog.close(); });
    }); asIcon(notes, '個人筆記', '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6M10 16h4"/>');
}
