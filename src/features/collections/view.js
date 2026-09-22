import { auth, database, ref, get, runTransaction } from '../../services/firebase.js';
import { quizLabel } from '../mistakes/model.js';
import { markdown } from '../../shared/content.js';
const node = (tag, text, parent, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; parent?.append(n); return n; };
const button = (label, parent, action, cls = 'quiet-button') => { const b = node('button', label, parent, cls); b.type = 'button'; b.onclick = action; return b; };
const identity = q => JSON.stringify([q.source || '', q.question]);
const plain = text => { const n = document.createElement('div'); n.innerHTML = markdown(text || ''); return n.textContent; };
export function createCollection({ host, activate, practice, renderMath, onRemove, getSourceLabel = source => source || '' }) {
    const unit = q => quizLabel(getSourceLabel(q.source)).subject;
    let rows = [], selectedUnit = null, query = '', source = '', owner = null, version = 0;
    const selected = new Set();
    let preview = null, trigger = null;
    const titlebar = node('header', null, host, 'collection-heading');
    node('h2', '已收藏', titlebar);
    const count = node('span', '', titlebar, 'collection-muted');
    const crumbs = node('nav', null, host, 'collection-breadcrumb'); crumbs.setAttribute('aria-label', '收藏單元');
    const toolbar = node('div', null, host, 'collection-toolbar');
    const search = node('input', null, toolbar, 'library-search'); search.type = 'search'; search.placeholder = '搜尋單元或題目'; search.setAttribute('aria-label', '搜尋收藏');
    const filter = node('select', null, toolbar); filter.setAttribute('aria-label', '篩選收藏題庫');
    const status = node('p', '', host, 'collection-muted'); status.setAttribute('role', 'status');
    const batch = node('div', null, host, 'collection-batch'); batch.hidden = true;
    const workspace = node('div', null, host, 'collection-workspace');
    const list = node('div', null, workspace, 'collection-list');
    const detail = node('aside', null, workspace, 'collection-detail'); detail.hidden = true; detail.setAttribute('aria-label', '收藏題目詳情');
    function closePreview() { detail.hidden = true; workspace.classList.remove('has-preview'); preview = null; if (trigger?.isConnected) trigger.focus(); }
    async function start(items, b) {
        if (owner !== auth.currentUser?.uid) { status.textContent = '請重新登入後開啟收藏。'; return; }
        b.disabled = true; status.textContent = '';
        try { await practice(items); closePreview(); } catch (e) { status.textContent = e.message || '無法開始練習'; } finally { b.disabled = false; }
    }
    function renderBatch() {
        batch.replaceChildren(); batch.hidden = !selected.size;
        node('span', `已選取 ${selected.size} 題`, batch);
        button('取消選取', batch, () => { selected.clear(); render(); });
        const go = button('練習所選題目', batch, () => start(rows.filter(q => selected.has(identity(q))), go), 'primary-button');
    }
    async function remove(q, b) {
        if (owner !== auth.currentUser?.uid) return;
        b.disabled = true; const uid = owner;
        try {
            await runTransaction(ref(database, `progress/${owner}/starred`), value => (value || []).filter(entry => identity(entry) !== identity(q)), { applyLocally: false });
            if (owner !== uid || auth.currentUser?.uid !== uid) return;
            rows = rows.filter(entry => identity(entry) !== identity(q)); selected.delete(identity(q));
            if (preview === q) closePreview();
            onRemove(q); render(); status.textContent = '已取消收藏';
        } catch { status.textContent = '取消收藏失敗，請重試。'; b.disabled = false; }
    }
    function showPreview(q, opener) {
        preview = q; trigger = opener; detail.replaceChildren(); detail.hidden = false; workspace.classList.add('has-preview');
        const header = node('div', null, detail, 'collection-detail-header');
        node('h3', '題目詳情', header);
        const close = button('關閉詳情', header, closePreview); close.focus();
        node('p', getSourceLabel(q.source) || '未分類', detail, 'collection-muted');
        node('div', null, detail, 'collection-question').innerHTML = markdown(q.question);
        if (q.options) { const options = node('div', null, detail, 'collection-options'); for (const [key, value] of Object.entries(q.options)) node('div', null, options).innerHTML = markdown(`${key}. ${value}`); }
        const answer = node('details', null, detail, 'collection-answer');
        node('summary', '答案與詳解', answer);
        node('div', null, answer).innerHTML = markdown(`**答案：** ${Array.isArray(q.answer) ? q.answer.join('、') : q.answer || '未提供'}`);
        node('div', null, answer).innerHTML = markdown(q.explanation || '尚無詳解');
        const actions = node('div', null, detail, 'collection-detail-actions');
        const unstar = button('取消收藏', actions, () => remove(q, unstar));
        const go = button('練習此題', actions, () => start([q], go), 'primary-button');
        renderMath(detail);
    }
    function render() {
        count.textContent = `${rows.length} 題`;
        crumbs.replaceChildren();
        if (selectedUnit !== null) {
            button('全部單元', crumbs, () => { selectedUnit = null; source = ''; query = ''; search.value = ''; selected.clear(); closePreview(); render(); });
            node('span', '/', crumbs); node('strong', selectedUnit, crumbs);
        }
        filter.hidden = selectedUnit === null;
        const sources = [...new Set(rows.filter(q => unit(q) === selectedUnit).map(q => q.source || ''))];
        if (!sources.includes(source)) source = '';
        filter.replaceChildren();
        for (const value of ['', ...sources.filter(Boolean)]) { const option = node('option', value ? quizLabel(getSourceLabel(value)).title : '全部題庫', filter); option.value = value; } filter.value = source;
        list.replaceChildren(); list.className = selectedUnit === null ? 'collection-list collection-units' : 'collection-list';
        const visible = rows.filter(q => (!query || `${getSourceLabel(q.source)} ${plain(q.question)}`.toLocaleLowerCase().includes(query)) && (selectedUnit === null || unit(q) === selectedUnit) && (!source || q.source === source));
        if (!visible.length) node('p', rows.length ? '沒有符合條件的收藏題目' : '尚無收藏題目', list, 'empty-state');
        if (selectedUnit === null) {
            const groups = new Map(); for (const q of visible) { const key = unit(q); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(q); }
            for (const [name, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'))) {
                const card = button('', list, () => { selectedUnit = name; source = ''; selected.clear(); render(); }, 'unit-card collection-unit');
                const icon = node('span', null, card, 'unit-icon-box'); icon.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 7V5h6l2 2h10v13H3Z"/></svg>';
                const info = node('span', null, card, 'unit-info'); node('strong', name, info, 'unit-title'); node('span', `${items.length} 題 · ${new Set(items.map(q => q.source)).size} 份題庫`, info, 'unit-subtitle');
            }
        } else for (const q of visible) {
            const row = node('article', null, list, 'collection-item');
            const check = node('input', null, row); check.type = 'checkbox'; check.checked = selected.has(identity(q)); check.setAttribute('aria-label', `選取 ${plain(q.question)}`);
            check.onchange = () => { check.checked ? selected.add(identity(q)) : selected.delete(identity(q)); renderBatch(); };
            const open = button('', row, () => showPreview(q, open), 'collection-open');
            node('span', plain(q.question), open, 'collection-summary'); node('small', quizLabel(getSourceLabel(q.source)).title || '未分類', open, 'collection-muted');
            const star = button('★', row, () => remove(q, star), 'quiet-button collection-star'); star.setAttribute('aria-label', '取消收藏'); star.title = '取消收藏';
        }
        renderBatch();
    }
    search.oninput = () => { query = search.value.trim().toLocaleLowerCase(); closePreview(); render(); };
    filter.onchange = () => { source = filter.value; closePreview(); render(); };
    detail.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); closePreview(); } };
    return {
        resetForUser(uid) {
            if (owner === uid) return;
            version++; owner = uid; rows = []; selected.clear(); selectedUnit = null; query = ''; source = ''; search.value = ''; closePreview(); render();
            status.textContent = uid ? '' : '請先登入以查看收藏。';
        },
        async open() {
            if (!auth.currentUser) throw new Error('請先登入以查看收藏。');
            activate(); const id = ++version;
            if (owner !== auth.currentUser.uid) { rows = []; selected.clear(); selectedUnit = null; query = ''; search.value = ''; source = ''; closePreview(); }
            owner = auth.currentUser.uid; status.textContent = '載入收藏中…'; render();
            try {
                const snapshot = await get(ref(database, `progress/${owner}/starred`));
                if (id !== version || owner !== auth.currentUser?.uid) return;
                rows = snapshot.val() || []; const ids = new Set(rows.map(identity)); for (const key of selected) if (!ids.has(key)) selected.delete(key);
                closePreview(); render(); status.textContent = '';
            } catch { if (id !== version || owner !== auth.currentUser?.uid) return; status.textContent = '收藏載入失敗'; button('重新載入', status, () => this.open()); }
        }
    };
}
