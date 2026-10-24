import { normalizeSearchText } from '../search/model.js';
import { changeBanks } from '../../services/catalog.js';

const node = (tag, text, parent, cls) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (cls) el.className = cls;
    parent?.append(el); return el;
};
const icons = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
    bank: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
};
const icon = name => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const button = (text, parent, action, cls = 'bank-text-button') => {
    const el = node('button', text, parent, cls); el.type = 'button'; el.onclick = action; return el;
};
export function bankLabel(key) {
    const clean = key.replace(/^_Archive_/, ''), split = clean.indexOf('｜');
    return split < 0 ? { subject: '其他', title: clean } : { subject: clean.slice(0, split), title: clean.slice(split + 1) };
}

export function mountBankLibrary({ grid, navigation, input, getUser, getProgress, getStorageKey, onFolder, onOpen, onChanged, onManage, refreshSearch }) {
    const $ = id => document.getElementById(id);
    let catalog = {}, archived = false, folder = null, query = '', managing = false;
    let selection = new Set(), visibleKeys = [], menu = null, menuTrigger = null;
    let layout = 'grid', sort = 'name', dialogState = null, busy = false, owner;
    try { layout = localStorage.getItem('teah-bank-layout') === 'list' ? 'list' : 'grid'; } catch {}
    const status = $('bankLibraryStatus'), bar = $('bankSelectionBar'), selectAll = $('bankSelectAll');
    const dialog = $('archiveConfirmModal'), form = $('bankActionForm'), confirm = $('archiveActionBtn'), cancel = $('archiveCancelBtn');
    const renameTitle = $('bankRenameTitle'), renameSubject = $('bankRenameSubject'), error = $('bankActionError');
    const requireUser = () => {
        if (getUser()) return true;
        status.textContent = '請先登入後再操作題庫。'; return false;
    };
    function closeMenu(restoreFocus = false) {
        if (!menu) return;
        menu.remove(); menu = null;
        menuTrigger?.setAttribute('aria-expanded', 'false');
        if (restoreFocus) menuTrigger?.focus();
        menuTrigger = null;
    }
    function progress(key) {
        const p = getProgress(catalog[key]?.storageKey || getStorageKey(key));
        const total = p?.allQuestions?.length || catalog[key]?.count || 0;
        const done = p?.allQuestions ? p.allQuestions.filter(q => q.isAnswered).length : p?.currentIndex || 0;
        return { percent: total ? Math.min(100, Math.round(done / total * 100)) : 0, total, done };
    }
    function updateSelection() {
        bar.hidden = !managing;
        const count = selection.size;
        $('bankSelectionCount').textContent = `已選取 ${count} 份${count ? ` · ${[...selection].reduce((sum, key) => sum + (catalog[key]?.count || 0), 0)} 題` : ''}`;
        selectAll.checked = visibleKeys.length > 0 && visibleKeys.every(key => selection.has(key));
        selectAll.indeterminate = visibleKeys.some(key => selection.has(key)) && !selectAll.checked;
        selectAll.disabled = !visibleKeys.length;
        $('bankBatchRename').disabled = count !== 1;
        $('bankBatchArchive').disabled = $('bankBatchDelete').disabled = $('bankSelectionClear').disabled = count === 0;
        $('bankBatchArchive').textContent = archived ? '還原至題庫' : '移至典藏';
        for (const card of grid.querySelectorAll('[data-json]')) {
            const selected = selection.has(card.dataset.json);
            card.classList.toggle('is-selected', selected);
            card.querySelector('.bank-checkbox').checked = selected;
            const open = card.querySelector('.bank-open');
            if (managing) open.setAttribute('aria-pressed', String(selected)); else open.removeAttribute('aria-pressed');
        }
    }
    function setManaging(value) {
        if (busy) return;
        if (value && !requireUser()) return;
        managing = value; selection.clear(); closeMenu();
        $('libraryManage').textContent = value ? '完成管理' : '管理題庫';
        $('libraryManage').setAttribute('aria-pressed', String(value)); onManage(value);
        render();
    }
    function toggle(key) {
        if (selection.has(key)) selection.delete(key); else selection.add(key);
        updateSelection();
    }
    function navigate(next) {
        folder = next; query = ''; input.value = ''; selection.clear();
        onFolder(next); render(); refreshSearch();
        (navigation.querySelector('.folder-back') || grid.querySelector('button'))?.focus({ preventScroll: true });
    }
    function openMenu(trigger, key) {
        if (busy) return;
        const same = menuTrigger === trigger; closeMenu(); if (same) return;
        menuTrigger = trigger; trigger.setAttribute('aria-expanded', 'true');
        menu = node('div', null, document.body, 'bank-action-menu'); menu.id = 'bankActionMenu';
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', `${bankLabel(key).title}的操作`);
        trigger.setAttribute('aria-controls', menu.id);
        for (const [label, action] of [['選取', 'select'], ['重新命名', 'rename'], [archived ? '還原至題庫' : '移至典藏', 'archive'], ['刪除題庫', 'delete']]) {
            const item = button(label, menu, () => {
                closeMenu(true);
                if (!requireUser()) return;
                if (action === 'select') { if (!managing) setManaging(true); toggle(key); }
                else openAction(action, [key]);
            }, action === 'delete' ? 'bank-menu-item bank-danger' : 'bank-menu-item');
            item.setAttribute('role', 'menuitem');
        }
        positionMenu();
        menu.querySelector('button').focus({ preventScroll: true });
    }
    function positionMenu() {
        if (!menu || !menuTrigger) return;
        const box = menuTrigger.getBoundingClientRect(), width = 208, height = menu.offsetHeight;
        if (box.bottom < 0 || box.top > innerHeight) { closeMenu(); return; }
        menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, box.right - width))}px`;
        menu.style.top = `${Math.max(8, box.bottom + height + 8 > innerHeight ? box.top - height - 4 : box.bottom + 4)}px`;
    }
    function renderNavigation(keys) {
        navigation.replaceChildren();
        const location = node('div', null, navigation, 'bank-location');
        if (folder) {
            const back = button(null, location, () => navigate(null), 'folder-back bank-icon-button');
            back.innerHTML = icon('back'); back.setAttribute('aria-label', '返回全部科目');
            button(archived ? '典藏庫' : '全部科目', location, () => navigate(null));
            node('span', '／', location, 'bank-muted');
            node('h3', folder, location, 'folder-title');
        } else node('h3', query ? '符合的題庫' : managing ? '全部題庫' : '全部科目', location, 'folder-title');
        node('span', `${keys.length} 份 · ${keys.reduce((sum, key) => sum + (catalog[key]?.count || 0), 0)} 題`, location, 'bank-summary');
        const controls = node('div', null, navigation, 'bank-view-controls');
        const sortLabel = node('label', '排序', controls, 'bank-sort-label');
        const select = node('select', null, sortLabel); select.setAttribute('aria-label', '題庫排序');
        for (const [value, label] of [['name', '名稱'], ['count', '題數'], ['progress', '作答進度']]) {
            const option = node('option', label, select); option.value = value;
        }
        select.value = sort; select.onchange = () => { sort = select.value; render(); navigation.querySelector('select').focus(); };
        const views = node('div', null, controls, 'bank-layout-switch'); views.setAttribute('role', 'group'); views.setAttribute('aria-label', '顯示方式');
        for (const [value, label] of [['grid', '格狀檢視'], ['list', '清單檢視']]) {
            const view = button(null, views, () => {
                layout = value; try { localStorage.setItem('teah-bank-layout', value); } catch {}
                render(); navigation.querySelector(`[aria-label="${label}"]`).focus();
            }, 'bank-icon-button');
            view.innerHTML = icon(value); view.setAttribute('aria-label', label); view.setAttribute('aria-pressed', String(layout === value));
        }
    }
    function render() {
        closeMenu();
        const keys = Object.keys(catalog).filter(key => key.startsWith('_Archive_') === archived);
        const scoped = keys.filter(key => (!folder || bankLabel(key).subject === folder) &&
            (!query || normalizeSearchText(key.replace(/^_Archive_/, '')).includes(query)));
        scoped.sort((a, b) => (sort === 'count' ? (catalog[b]?.count || 0) - (catalog[a]?.count || 0) :
            sort === 'progress' ? progress(b).percent - progress(a).percent : 0) || a.localeCompare(b, 'zh-Hant', { numeric: true }));
        visibleKeys = scoped;
        renderNavigation(scoped);
        const folders = !folder && !query && !managing;
        grid.className = `units-grid bank-library-grid ${layout === 'list' ? 'bank-list' : ''} ${managing ? 'is-managing' : ''} ${folders ? 'bank-folders' : ''}`;
        grid.replaceChildren();
        if (folders) {
            const groups = new Map();
            for (const key of scoped) { const subject = bankLabel(key).subject; if (!groups.has(subject)) groups.set(subject, []); groups.get(subject).push(key); }
            for (const [subject, banks] of [...groups].sort(([a], [b]) => (a === '其他') - (b === '其他') || a.localeCompare(b, 'zh-Hant'))) {
                const card = button(null, grid, () => navigate(subject), 'unit-card bank-folder');
                const box = node('span', null, card, 'unit-icon-box'); box.innerHTML = icon('folder');
                const info = node('span', null, card, 'unit-info'); node('span', subject, info, 'unit-title');
                node('span', `${banks.length} 份題庫 · ${banks.reduce((sum, key) => sum + (catalog[key]?.count || 0), 0)} 題`, info, 'unit-subtitle');
                node('span', '›', card, 'bank-folder-arrow').setAttribute('aria-hidden', 'true');
            }
        } else for (const key of scoped) {
            const label = bankLabel(key), p = progress(key);
            const card = node('article', null, grid, 'unit-card bank-card'); card.dataset.json = key;
            const checkLabel = node('label', null, card, 'bank-check-target');
            const checkbox = node('input', null, checkLabel, 'bank-checkbox'); checkbox.type = 'checkbox';
            checkbox.setAttribute('aria-label', `選取 ${label.title}`); checkbox.onchange = () => toggle(key);
            const open = button(null, card, () => {
                if (!requireUser()) return;
                if (managing) toggle(key); else onOpen(key);
            }, 'bank-open');
            const box = node('span', null, open, 'unit-icon-box'); box.innerHTML = icon('bank');
            const info = node('span', null, open, 'unit-info');
            if (!folder) node('span', label.subject, info, 'bank-subject');
            node('span', label.title, info, 'unit-title');
            node('span', `${catalog[key]?.count || 0} 題`, info, 'unit-subtitle');
            const state = node('span', null, open, 'bank-progress');
            node('span', p.percent >= 100 ? '已完成' : p.done ? `已作答 ${p.done}/${p.total}` : '尚未作答', state, p.percent >= 100 ? 'bank-complete' : '');
            if (p.done) {
                const track = node('span', null, state, 'bank-progress-track');
                const fill = node('span', null, track); fill.style.width = `${p.percent}%`;
            }
            const more = button(null, card, () => openMenu(more, key), 'bank-more bank-icon-button');
            more.innerHTML = icon('more'); more.setAttribute('aria-label', `${label.title}的更多操作`);
            more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
        }
        if (!scoped.length) {
            const empty = node('div', null, grid, 'empty-state');
            node('p', query ? '沒有符合的題庫' : archived ? '尚無典藏題庫' : '目前沒有題庫', empty);
            if (query) button('清除搜尋', empty, () => { input.value = ''; refreshSearch(); input.focus(); });
        }
        updateSelection();
    }
    function openAction(action, keys) {
        if (!requireUser() || busy) return;
        closeMenu();
        dialogState = { action, keys: [...keys], uid: getUser() };
        const deleting = action === 'delete', renaming = action === 'rename';
        const label = renaming ? '重新命名題庫' : deleting ? '刪除題庫' : archived ? '還原至題庫' : '移至典藏';
        $('archiveConfirmTitle').textContent = label;
        $('archiveConfirmMessage').textContent = renaming ? '修改科目或題庫名稱。' : deleting
            ? '題庫及其中的題目將永久刪除，所有使用者都無法再開啟。此操作無法復原；個人作答紀錄與收藏快照會保留。'
            : archived ? '所選題庫將移回題庫，作答紀錄會保留。' : '所選題庫將移至典藏庫，可隨時還原。';
        const list = $('bankActionList'); list.replaceChildren(); list.hidden = renaming;
        for (const key of keys) {
            const item = node('li', null, list); const info = node('span', null, item);
            node('span', bankLabel(key).subject, info, 'bank-muted'); node('strong', bankLabel(key).title, info);
            node('span', `${catalog[key]?.count || 0} 題`, item, 'bank-muted');
        }
        $('bankRenameFields').hidden = !renaming;
        const current = bankLabel(keys[0]); renameSubject.value = current.subject === '其他' ? '' : current.subject; renameTitle.value = current.title;
        error.hidden = true; confirm.classList.toggle('bank-danger-filled', deleting);
        confirm.textContent = renaming ? '儲存' : `${label}${keys.length > 1 ? `（${keys.length} 份）` : ''}`;
        dialog.style.display = 'flex';
        queueMicrotask(() => (renaming ? renameTitle : cancel).focus());
    }
    function dismiss() { if (busy) return; dialog.style.display = 'none'; dialogState = null; }
    cancel.onclick = dismiss;
    dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });
    form.onsubmit = async event => {
        event.preventDefault(); if (busy || !dialogState) return;
        const state = dialogState;
        if (state.uid !== getUser()) { error.textContent = '登入狀態已變更，請關閉視窗後重試。'; error.hidden = false; return; }
        let renamed = '';
        if (state.action === 'rename') {
            const title = renameTitle.value.trim(), subject = renameSubject.value.trim();
            if (!title || /[｜\x00-\x1f\x7f]/.test(title + subject)) {
                error.textContent = '請輸入題庫名稱；科目與名稱不可包含 ｜ 或控制字元。'; error.hidden = false; renameTitle.focus(); return;
            }
            renamed = `${state.keys[0].startsWith('_Archive_') ? '_Archive_' : ''}${subject ? `${subject}｜` : ''}${title}`;
        }
        busy = true; const label = confirm.textContent; error.hidden = true;
        confirm.disabled = cancel.disabled = renameTitle.disabled = renameSubject.disabled = true;
        form.setAttribute('aria-busy', 'true'); confirm.textContent = '處理中…';
        try {
            const changes = await changeBanks(state.action, state.keys, renamed);
            selection.clear();
            status.textContent = state.action === 'rename' ? '已儲存題庫名稱。' : state.action === 'delete' ? `已刪除 ${state.keys.length} 份題庫。` : `已${archived ? '還原' : '典藏'} ${state.keys.length} 份題庫。`;
            dialog.style.display = 'none'; dialogState = null;
            // Reflect the acknowledged write immediately, even if refreshing the catalog fails.
            const previous = { ...catalog };
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) delete catalog[key];
                else {
                    const source = state.action === 'rename' ? state.keys[0] : key.startsWith('_Archive_') ? key.slice(9) : `_Archive_${key}`;
                    catalog[key] = { count: value.length, storageKey: previous[source]?.storageKey || getStorageKey(source) };
                }
            }
            render(); $('libraryManage').focus({ preventScroll: true });
            await onChanged(changes);
        } catch (cause) {
            error.textContent = /permission/i.test(`${cause.code || ''} ${cause.message}`)
                ? '權限不足，無法修改題庫。請使用有題庫管理權限的帳號。' : cause.message || '操作失敗，請重試。';
            error.hidden = false;
        } finally {
            busy = false; confirm.disabled = cancel.disabled = renameTitle.disabled = renameSubject.disabled = false;
            form.setAttribute('aria-busy', 'false'); confirm.textContent = label;
        }
    };
    $('libraryManage').onclick = () => setManaging(!managing);
    selectAll.onchange = () => { selection = selectAll.checked ? new Set(visibleKeys) : new Set(); updateSelection(); };
    $('bankSelectionClear').onclick = () => { selection.clear(); updateSelection(); selectAll.focus(); };
    for (const [id, action] of [['bankBatchRename', 'rename'], ['bankBatchArchive', 'archive'], ['bankBatchDelete', 'delete']]) $(id).onclick = () => openAction(action, [...selection]);
    document.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target) && event.target !== menuTrigger && !menuTrigger?.contains(event.target)) closeMenu(); });
    document.addEventListener('focusin', event => { if (menu && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu(); });
    document.addEventListener('keydown', event => {
        if (!menu) return;
        const items = [...menu.querySelectorAll('button')], index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
    });
    window.addEventListener('resize', () => closeMenu());
    document.addEventListener('scroll', () => positionMenu(), true);
    return {
        render(data, options) {
            if (owner !== getUser() || archived !== options.archived) { selection.clear(); managing = false; $('libraryManage').textContent = '管理題庫'; $('libraryManage').setAttribute('aria-pressed', 'false'); onManage(false); }
            owner = getUser(); catalog = { ...data }; archived = options.archived; folder = options.folder;
            selection = new Set([...selection].filter(key => catalog[key]));
            if (folder && !Object.keys(catalog).some(key => key.startsWith('_Archive_') === archived && bankLabel(key).subject === folder)) { folder = null; onFolder(null); }
            query = normalizeSearchText(input.value); render();
        },
        filter(value) { if (query === value) return; query = value; selection.clear(); render(); },
        toggleManage() { setManaging(!managing); },
        stopManaging() { setManaging(false); },
        resetForUser() { selection.clear(); setManaging(false); dismiss(); status.textContent = ''; },
    };
}
