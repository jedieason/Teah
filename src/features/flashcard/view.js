import { auth } from '../../services/firebase.js';
import { DEFAULT_OPTIONS, MAX_CARDS, id, clone, normalize, parseImport, shuffled, projectStudy, progressCounts, createSession, submitAnswer, overrideCorrect, advanceSession, continueRound, sessionProgress, factKey, promptFor, answerFor, answersFor, gradeAnswer } from './model.js';
import { loadDecks, saveDeck, loadStudy, saveStudy, newEvent, saveDraft, readDraft, clearDraft, changeDeleted, discardConflicts, flushOutbox, semanticGrade } from './service.js';
const node = (tag, text, parent, className) => {
    const e = document.createElement(tag); if (text != null) e.textContent = text;
    if (className) e.className = className; parent?.append(e); return e;
};
const languages = [['en-US', 'English'], ['zh-TW', '繁體中文'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['es-ES', 'Español'], ['it-IT', 'Italiano'], ['la', 'Latin'], ['math', '數學／化學符號']];
const typeLabels = { choice: '選擇題', multi: '複選題', written: '書寫／填空題', flash: '字卡', truefalse: '是非題', spell: '聽寫題' };
export function mountFlashcard({ host, activate }) {
    let owner = null, decks = {}, deck = null, study = {}, phase = 'list', draft = null, session = null, flash = null;
    let message = '', conflict = false, operation = 0, busy = false, timer = null, draftTimer = null, questionAt = Date.now(), trash = false;
    let preferred = { ...DEFAULT_OPTIONS }, direction = 'term', search = '';
    let screen = '', termFilter = 'all', termQuery = '';
    let audioContext, progressWidths = [];
    const dialog = node('dialog', null, document.body, 'vocab-dialog');
    function report(text) { message = text; const status = host.querySelector('.vocab-status'); if (status) status.textContent = text; }
    function stop() { clearTimeout(timer); timer = null; window.speechSynthesis?.cancel(); }
    function safeOwner() { if (!owner || auth.currentUser?.uid !== owner) throw new Error('請先登入或重新開啟 Flashcard。'); }
    async function action(work) {
        if (busy) return; busy = true; host.setAttribute('aria-busy', 'true');
        try { safeOwner(); await work(); } catch (e) { report(e.message || '操作失敗，請重試。'); }
        finally { busy = false; host.setAttribute('aria-busy', 'false'); }
    }
    function button(text, parent, work, cls = '') {
        const b = node('button', text, parent, `vocab-button ${cls}`); b.type = 'button';
        b.onclick = () => action(work); return b;
    }
    function icon(text, label, parent, work) {
        const b = button(text, parent, work, 'vocab-icon'); b.setAttribute('aria-label', label); b.title = label;
        if (text === '◖))') b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
        return b;
    }
    function field(label, parent, value = '', type = 'input') {
        const l = node('label', null, parent, 'vocab-field'); node('span', label, l);
        const input = node(type, null, l); input.setAttribute('aria-label', label); input.value = value; return input;
    }
    function select(label, parent, values, value) {
        const s = field(label, parent, '', 'select');
        for (const [v, text] of values) { const o = node('option', text, s); o.value = v; }
        s.value = value; return s;
    }
    function check(label, parent, checked) {
        const l = node('label', null, parent, 'vocab-check'); const input = node('input', null, l); input.type = 'checkbox'; input.checked = checked; node('span', label, l); return input;
    }
    function text(value, parent, cls = '') {
        const e = node('div', null, parent, cls);
        // Small formatting vocabulary, constructed as DOM; pasted HTML is always literal text.
        const regex = /\*\*(.+?)\*\*|__(.+?)__|==(.+?)==|\*([^*]+?)\*/gs;
        let end = 0;
        for (const match of String(value).matchAll(regex)) {
            e.append(document.createTextNode(String(value).slice(end, match.index)));
            const tag = match[1] ? 'strong' : match[2] ? 'u' : match[3] ? 'mark' : 'em';
            node(tag, match[1] || match[2] || match[3] || match[4], e); end = match.index + match[0].length;
        }
        e.append(document.createTextNode(String(value).slice(end))); return e;
    }
    function heading(title, back) {
        const h = node('header', null, host, 'vocab-heading');
        if (back) button('‹ ' + back.label, h, back.action, 'vocab-back');
        const titleNode = node('h1', title, h); titleNode.tabIndex = -1;
        return h;
    }
    function render() {
        const nextScreen = `${phase}:${deck?.id || ''}:${phase === 'learn' ? `${session?.id}:${session?.current?.key || ''}:${session?.round}:${!!session?.checkpoint}:${!!session?.completed}` : ''}`;
        const changedScreen = screen !== nextScreen;
        const roundTermsOpen = !changedScreen ? host.querySelector('.vocab-round-terms')?.open : undefined;
        screen = nextScreen;
        progressWidths = [...host.querySelectorAll('.vocab-learn-progress i')].map(e => e.style.width);
        stop(); host.replaceChildren();
        host.dataset.phase = phase;
        host.dataset.ordinal = phase === 'learn' ? String(session?.ordinal || 0) : '';
        host.dataset.feedback = phase === 'learn' && session?.feedback ? session.feedback.correct ? 'correct' : 'wrong' : 'none';
        host.dataset.currentKey = phase === 'learn' ? session?.current?.key || '' : '';
        const status = node('p', message, host, 'vocab-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        if (conflict) {
            const resolve = node('div', null, host, 'vocab-conflict');
            button('保留本機版本為新字卡集', resolve, async () => {
                const candidate = deck?.id === host.dataset.conflictDeck ? deck : decks[host.dataset.conflictDeck];
                const local = candidate ? clone(candidate) : null;
                if (!local) throw new Error('請先開啟發生衝突的字卡集。');
                await discardConflicts(local.id);
                const result = await loadDecks(); decks = result.decks;
                local.id = id(); local.title += '（本機副本）';
                deck = await saveDeck(local); decks[deck.id] = deck; study = {}; conflict = false; message = '本機版本已保留為新字卡集。'; phase = 'detail'; render();
            });
            button('重新載入雲端版本', resolve, async () => {
                await discardConflicts(host.dataset.conflictDeck || deck?.id); conflict = false;
                const result = await loadDecks(); decks = result.decks; deck = null; message = ''; phase = 'list'; render();
            });
        }
        if (!owner) { heading('Flashcard'); node('p', '登入後即可建立字卡集與保存學習進度。', host, 'vocab-empty'); return; }
        if (phase === 'list') renderList();
        if (phase === 'detail') renderDetail();
        if (phase === 'editor') renderEditor();
        if (phase === 'learn') renderLearn();
        if (phase === 'flash') renderFlash();
        const roundTerms = host.querySelector('.vocab-round-terms');
        if (roundTerms && roundTermsOpen !== undefined) roundTerms.open = roundTermsOpen;
        if (changedScreen) window.scrollTo(0, 0);
    }
    function renderList() {
        const h = heading('Flashcard'); button('＋ 建立字卡集', h, () => edit(null), 'vocab-primary');
        const toolbar = node('div', null, host, 'vocab-toolbar');
        const query = field('搜尋字卡集', toolbar, search); query.type = 'search'; query.placeholder = '字卡集名稱或內容';
        button(trash ? '返回字卡集' : '已刪除', toolbar, () => { trash = !trash; render(); });
        button('重新同步', toolbar, async () => { await flushOutbox(); const result = await loadDecks(); decks = result.decks; message = result.error || (result.pending ? `${result.pending} 筆等待同步` : '資料已同步'); render(); });
        const grid = node('div', null, host, 'vocab-grid');
        function list() {
            grid.replaceChildren(); const filtered = Object.values(decks).filter(d => !!d.deletedAt === trash && normalize(d.title + ' ' + d.description + ' ' + d.cards.map(c => c.term + ' ' + c.definition).join(' ')).includes(normalize(search))).sort((a, b) => b.updatedAt - a.updatedAt);
            if (!filtered.length) node('p', trash ? '沒有已刪除字卡集' : search ? '沒有符合的字卡集' : '尚無字卡集', grid, 'vocab-empty');
            for (const d of filtered) {
                const card = node('article', null, grid, 'vocab-deck');
                const open = button(d.title, card, () => openDeck(d.id), 'vocab-deck-title'); if (trash) open.disabled = true;
                node('p', `${d.cards.length} 張字卡`, card, 'vocab-muted');
                if (d.description) node('p', d.description, card, 'vocab-description');
                const preview = node('div', null, card, 'vocab-deck-preview');
                d.cards.slice(0, 3).forEach(c => { const row = node('div', null, preview); text(c.term, row); text(c.definition, row); });
                if (trash) button('復原字卡集', card, async () => { decks[d.id] = await changeDeleted(d, false); render(); });
                else button('開始 Learn', card, async () => { await openDeck(d.id); settings(); }, 'vocab-link');
            }
        }
        query.oninput = () => { search = query.value; list(); }; list();
    }
    async function openDeck(deckId) {
        const ticket = ++operation; if (deck?.id !== deckId) { termFilter = 'all'; termQuery = ''; } deck = decks[deckId]; if (!deck) return;
        study = await loadStudy(deckId); safeOwner(); if (ticket !== operation) return;
        phase = 'detail'; preferred = study.sessions?.learn?.options || preferred; message = ''; render();
    }
    function stats(parent, counts) {
        const wrap = node('div', null, parent, 'vocab-stats');
        for (const [key, label] of [['new', '未學習'], ['learning', '正在學習'], ['mastered', '已精熟']]) {
            const item = node('div', null, wrap, `vocab-stat ${key}`); node('strong', counts[key], item); node('span', label, item);
        }
    }
    async function star(card) { const value = !projectStudy(study).stars[card.id]; study = await saveStudy(deck.id, study, newEvent('star', { cardId: card.id, value })); render(); }
    function starButton(card, parent) { const starred = !!projectStudy(study).stars[card.id]; const b = icon(starred ? '★' : '☆', starred ? '取消星號' : '標記星號', parent, () => star(card)); b.classList.toggle('starred', starred); b.setAttribute('aria-pressed', String(starred)); }
    function renderDetail() {
        const h = heading(deck.title, { label: 'Flashcard', action: () => { phase = 'list'; deck = null; render(); } });
        button('編輯字卡集', h, () => edit(deck));
        if (deck.description) node('p', deck.description, host, 'vocab-description');
        const projected = projectStudy(study), counts = progressCounts(deck, projected, direction);
        const studyModes = node('div', null, host, 'vocab-modes');
        button('Flashcards', studyModes, () => startFlash(), 'vocab-mode');
        button('Learn', studyModes, () => settings(), 'vocab-mode vocab-primary');
        const saved = study.sessions?.learn;
        if (saved && saved.deckRevision === deck.revision && saved.generation === projected.generation && !saved.completed) button('繼續 Learn', studyModes, () => { session = clone(saved); phase = 'learn'; render(); }, 'vocab-mode');
        const controls = node('div', null, host, 'vocab-toolbar');
        const dir = select('進度方向', controls, [['term', '看解釋 → 答單字'], ['definition', '看單字 → 答解釋'], ['both', '正反向']], direction);
        dir.onchange = () => { direction = dir.value; render(); };
        button('匯出文字', controls, () => exportText());
        button('刪除字卡集', controls, async () => { decks[deck.id] = await changeDeleted(deck, true); message = '字卡集已移至「已刪除」，可隨時復原。'; deck = null; phase = 'list'; render(); });
        stats(host, counts);
        const track = node('div', null, host, 'vocab-mastery-track'); track.setAttribute('role', 'img'); track.setAttribute('aria-label', `${counts.mastered} 張已精熟，${counts.learning} 張正在學習，${counts.new} 張未學習`);
        for (const key of ['mastered', 'learning', 'new']) { const segment = node('span', null, track, key); segment.style.width = `${counts[key] / counts.total * 100}%`; }
        const toolbar = node('div', null, host, 'vocab-toolbar');
        node('h2', `單字（${deck.cards.length}）`, toolbar);
        const filter = select('單字範圍', toolbar, [['all', '全部'], ['starred', '已標星號'], ['new', '未學習'], ['learning', '正在學習'], ['mastered', '已精熟']], termFilter);
        const query = field('搜尋單字', toolbar, termQuery); query.type = 'search';
        const terms = node('div', null, host, 'vocab-terms');
        function rows() {
            terms.replaceChildren();
            for (const c of deck.cards) {
                const count = progressCounts({ cards: [c] }, projected, direction), status = count.mastered ? 'mastered' : count.learning ? 'learning' : 'new';
                if (filter.value === 'starred' && !projected.stars[c.id] || !['all', 'starred', status].includes(filter.value) || !normalize(c.term + ' ' + c.definition).includes(normalize(query.value))) continue;
                const row = node('article', null, terms, 'vocab-term'); text(c.term, row, 'vocab-term-word'); text(c.definition, row, 'vocab-term-definition');
                node('span', { new: '未學習', learning: '正在學習', mastered: '已精熟' }[status], row, `vocab-pill ${status}`); starButton(c, row);
            }
            if (!terms.children.length) node('p', '沒有符合的單字', terms, 'vocab-empty');
        }
        filter.onchange = () => { termFilter = filter.value; rows(); }; query.oninput = () => { termQuery = query.value; rows(); }; rows();
    }
    async function edit(previous) {
        const recovered = await readDraft(previous?.id); safeOwner();
        draft = recovered && (!previous || recovered.baseRevision === previous.revision) ? recovered : { ...(previous ? clone(previous) : { title: '', description: '', termLanguage: 'en-US', definitionLanguage: 'zh-TW', cards: Array.from({ length: 3 }, () => ({ id: id(), term: '', definition: '' })) }), baseRevision: previous?.revision || 0 };
        deck = previous; phase = 'editor'; message = recovered ? '已恢復此裝置的編輯草稿。' : ''; render();
    }
    function queueDraft() {
        const snapshot = clone(draft), deckId = deck?.id, draftOwner = owner; clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            if (owner !== draftOwner || auth.currentUser?.uid !== draftOwner) return;
            void saveDraft(deckId, snapshot).then(() => { if (phase === 'editor' && owner === draftOwner) report('草稿已保存在此裝置。'); }).catch(e => { if (owner === draftOwner) report(e.message); });
        }, 350);
    }
    function renderEditor() {
        const h = heading(deck ? '編輯字卡集' : '建立字卡集', { label: deck ? '字卡集' : 'Flashcard', action: async () => { clearTimeout(draftTimer); await saveDraft(deck?.id, clone(draft)); phase = deck ? 'detail' : 'list'; render(); } });
        h.classList.add('vocab-editor-heading');
        async function save(andLearn = false) {
            clearTimeout(draftTimer);
            const value = { ...draft, cards: draft.cards.filter(c => c.term.trim() || c.definition.trim()) }, oldId = deck?.id;
            const next = await saveDeck(value, deck); safeOwner(); await clearDraft(oldId);
            deck = next; decks[next.id] = next; study = await loadStudy(next.id); phase = 'detail'; message = '字卡集已保存在此裝置。'; render(); if (andLearn) settings();
        }
        button('完成', h, () => save(), 'vocab-primary'); button('建立並練習', h, () => save(true));
        const meta = node('div', null, host, 'vocab-meta');
        for (const [key, label, type, max] of [['title', '字卡集名稱', 'input', 160], ['description', '說明（選填）', 'textarea', 2000]]) {
            const input = field(label, meta, draft[key], type); input.maxLength = max; input.oninput = () => { draft[key] = input.value; queueDraft(); };
        }
        const langs = node('div', null, host, 'vocab-toolbar');
        for (const [key, label] of [['termLanguage', '單字語言'], ['definitionLanguage', '解釋語言']]) { const s = select(label, langs, languages, draft[key]); s.onchange = () => { draft[key] = s.value; queueDraft(); }; }
        const toolbar = node('div', null, host, 'vocab-toolbar');
        button('匯入文字', toolbar, () => importDialog(), 'vocab-primary');
        button('交換單字與解釋', toolbar, () => { draft.cards = draft.cards.map(c => ({ ...c, term: c.definition, definition: c.term, termAliases: c.definitionAliases || [], definitionAliases: c.termAliases || [] })); [draft.termLanguage, draft.definitionLanguage] = [draft.definitionLanguage, draft.termLanguage]; queueDraft(); render(); });
        node('span', `${draft.cards.length}／${MAX_CARDS} 張`, toolbar, 'vocab-muted');
        const list = node('div', null, host, 'vocab-editor-rows'); let dragIndex = null;
        function redraw(focusIndex) {
            list.replaceChildren();
            draft.cards.forEach((c, i) => {
                const row = node('article', null, list, 'vocab-edit-row'); row.dataset.index = i;
                const top = node('div', null, row, 'vocab-row-tools'); node('span', i + 1, top, 'vocab-row-number');
                const handle = node('span', '⠿', top, 'vocab-drag'); handle.draggable = true; handle.title = '拖曳調整順序';
                handle.ondragstart = e => { dragIndex = i; e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; };
                row.ondragover = e => { if (dragIndex != null) e.preventDefault(); };
                row.ondrop = e => { e.preventDefault(); if (dragIndex == null) return; const [moved] = draft.cards.splice(dragIndex, 1); draft.cards.splice(i, 0, moved); dragIndex = null; queueDraft(); redraw(i); };
                handle.ondragend = () => { dragIndex = null; };
                const move = shift => { const dest = i + shift; if (dest < 0 || dest >= draft.cards.length) return; [draft.cards[i], draft.cards[dest]] = [draft.cards[dest], draft.cards[i]]; queueDraft(); redraw(dest); };
                const up = icon('↑', `第 ${i + 1} 張上移`, top, () => move(-1)); up.disabled = i === 0;
                const down = icon('↓', `第 ${i + 1} 張下移`, top, () => move(1)); down.disabled = i === draft.cards.length - 1;
                icon('×', `刪除第 ${i + 1} 張`, top, () => { const removed = draft.cards.splice(i, 1)[0]; queueDraft(); redraw(); report('已刪除一張字卡。'); const undo = button('復原刪除', host.querySelector('.vocab-status'), () => { draft.cards.splice(i, 0, removed); queueDraft(); render(); }); undo.focus(); });
                const sides = node('div', null, row, 'vocab-edit-sides');
                for (const [key, label] of [['term', '單字'], ['definition', '解釋']]) {
                    const wrap = node('div', null, sides); const input = field(`${label} ${i + 1}`, wrap, c[key], 'textarea'); input.maxLength = 4000; input.rows = 2;
                    input.oninput = () => { c[key] = input.value; queueDraft(); };
                    input.onkeydown = e => {
                        if (key === 'definition' && e.key === 'Tab' && !e.shiftKey && i === draft.cards.length - 1 && draft.cards.length < MAX_CARDS) { e.preventDefault(); draft.cards.push({ id: id(), term: '', definition: '' }); queueDraft(); redraw(i + 1); }
                    };
                    const formatting = node('div', null, wrap, 'vocab-format');
                    for (const [title, marker] of [['粗體', '**'], ['斜體', '*'], ['底線', '__'], ['標示', '==']]) {
                        const b = button(title, formatting, () => { const start = input.selectionStart, end = input.selectionEnd; input.setRangeText(marker + input.value.slice(start, end) + marker, start, end, 'select'); c[key] = input.value; queueDraft(); input.focus(); }); b.tabIndex = -1;
                    }
                }
                const aliases = node('details', null, row, 'vocab-aliases'); node('summary', '替代答案', aliases);
                for (const [key, label] of [['termAliases', '單字替代答案（每行一個）'], ['definitionAliases', '解釋替代答案（每行一個）']]) {
                    const a = field(label, aliases, (c[key] || []).join('\n'), 'textarea'); a.rows = 2; a.oninput = () => { c[key] = a.value.split('\n').filter(Boolean); queueDraft(); };
                }
                button('＋ 插入下一張', row, () => { if (draft.cards.length >= MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張。`); draft.cards.splice(i + 1, 0, { id: id(), term: '', definition: '' }); queueDraft(); redraw(i + 1); }, 'vocab-insert');
            });
            if (focusIndex != null) list.querySelector(`[data-index="${focusIndex}"] textarea`)?.focus();
        }
        redraw(); button('＋ 新增字卡', host, () => { if (draft.cards.length >= MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張。`); draft.cards.push({ id: id(), term: '', definition: '' }); queueDraft(); redraw(draft.cards.length - 1); }, 'vocab-add');
        button('儲存字卡集', host, () => save(), 'vocab-primary vocab-save-bottom');
    }
    function modal(title) {
        stop(); dialog.replaceChildren(); dialog.setAttribute('aria-label', title);
        const h = node('header', null, dialog, 'vocab-heading'); node('h2', title, h); icon('×', '關閉對話框', h, () => dialog.close());
        const body = node('div', null, dialog, 'vocab-dialog-body'); dialog.showModal(); return body;
    }
    function importDialog(exportMode = false) {
        const body = modal(exportMode ? '匯出文字' : '匯入文字');
        const input = field(exportMode ? '匯出內容' : '貼上文字', body, '', 'textarea'); input.rows = 8; input.spellcheck = false;
        input.placeholder = 'apple\t蘋果\nbanana\t香蕉';
        const controls = node('div', null, body, 'vocab-import-controls');
        const term = select('單字與解釋之間', controls, [['tab', 'Tab'], ['comma', '逗號 ,'], ['dash', '連字號 -'], ['custom', '自訂']], 'tab');
        const termCustom = field('自訂單字分隔符', controls); termCustom.maxLength = 20; termCustom.hidden = true; termCustom.parentElement.hidden = true;
        const row = select('字卡與字卡之間', controls, [['newline', '換行'], ['semicolon', '分號 ;'], ['custom', '自訂']], 'newline');
        const rowCustom = field('自訂字卡分隔符', controls); rowCustom.maxLength = 20; rowCustom.parentElement.hidden = true;
        const status = node('p', '', body, 'vocab-import-status'); status.setAttribute('role', 'status');
        const preview = node('div', null, body, 'vocab-import-preview'); let parsed = null;
        const confirm = button(exportMode ? '下載文字檔' : '匯入', body, () => {
            if (exportMode) { download(input.value, deck.title + '.txt', 'text/plain'); return; }
            if (!parsed?.cards.length || parsed.errors.length) return;
            const keep = draft.cards.filter(c => c.term.trim() || c.definition.trim());
            if (keep.length + parsed.cards.length > MAX_CARDS) throw new Error(`加上現有字卡後超過 ${MAX_CARDS} 張。`);
            draft.cards = [...keep, ...parsed.cards.map(c => ({ ...c, id: id() }))]; queueDraft(); dialog.close(); message = `已匯入 ${parsed.cards.length} 張字卡。`; render();
        }, 'vocab-primary');
        function update() {
            termCustom.parentElement.hidden = term.value !== 'custom'; termCustom.hidden = false; rowCustom.parentElement.hidden = row.value !== 'custom';
            const options = { term: term.value, row: row.value, termCustom: termCustom.value, rowCustom: rowCustom.value };
            if (exportMode) {
                const a = term.value === 'tab' ? '\t' : term.value === 'comma' ? ',' : term.value === 'dash' ? '-' : termCustom.value;
                const b = row.value === 'newline' ? '\n' : row.value === 'semicolon' ? ';' : rowCustom.value;
                input.value = deck.cards.map(c => c.term + a + c.definition).join(b); input.readOnly = true;
                status.textContent = '內容包含分隔符號時，請改用自訂分隔符。'; return;
            }
            try {
                parsed = parseImport(input.value, options); preview.replaceChildren(); confirm.disabled = !parsed.cards.length || parsed.errors.length > 0;
                status.textContent = `${parsed.cards.length} 張字卡` + (parsed.errors.length ? ` · ${parsed.errors.length} 處格式問題：第 ${parsed.errors[0].row} 行${parsed.errors[0].message}` : '') + (parsed.duplicates ? ` · ${parsed.duplicates} 張重複（會保留）` : '');
                for (const [i, c] of parsed.cards.slice(0, 200).entries()) { const r = node('div', null, preview); node('span', i + 1, r); node('span', c.term || '（空白）', r); node('span', c.definition || '（空白）', r); }
                if (parsed.cards.length > 200) node('p', `預覽前 200 張，匯入共 ${parsed.cards.length} 張。`, preview);
            } catch (e) { status.textContent = e.message; confirm.disabled = true; parsed = null; }
        }
        for (const e of [input, termCustom, rowCustom]) e.oninput = update; term.onchange = update; row.onchange = update; update();
    }
    function exportText() { importDialog(true); }
    function download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = node('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    function settings() {
        const body = modal('Learn 設定'); const options = { ...DEFAULT_OPTIONS, ...preferred };
        const goal = select('這次學習的目標', body, [['master', '記熟全部'], ['quick', '快速熟悉']], options.goal);
        const familiarity = select('對這組單字的熟悉程度', body, [['new', '剛開始學'], ['familiar', '已經看過']], options.familiarity);
        const dir = select('作答方向', body, [['term', '看解釋 → 答單字'], ['definition', '看單字 → 答解釋'], ['both', '正反向']], options.direction);
        const scope = select('練習範圍', body, [['all', '全部'], ['starred', '已標星號'], ['learning', '尚未精熟'], ['due', '到期複習']], options.scope);
        const group = node('fieldset', null, body, 'vocab-types'); node('legend', '題型', group); const types = {};
        for (const [type, label] of Object.entries(typeLabels)) types[type] = check(label, group, options.types.includes(type));
        const grading = select('批改方式', body, [['strict', '嚴格：忽略大小寫與基本標點'], ['moderate', '適中：接受英文單字的一處拼字差異'], ['relaxed', '寬鬆：接受意思相同的答案']], options.grading);
        node('p', '替代答案可在字卡編輯中設定；數字、數學符號與單位會保留檢查。', body, 'vocab-muted');
        const semanticNotice = node('p', '寬鬆批改會將這一題、正解與作答傳送至 Google Gemini；無法連線時使用嚴格批改，可自行更正結果。', body, 'vocab-muted'); semanticNotice.hidden = grading.value !== 'relaxed'; grading.onchange = () => { semanticNotice.hidden = grading.value !== 'relaxed'; };
        const retype = check('答錯後重打正解', body, options.retype), shuffle = check('打亂順序', body, options.shuffle), audio = check('朗讀題目', body, options.audio), sound = check('答題音效', body, options.sound);
        const chunk = select('每組單字數', body, [['7', '7 張'], ['5', '5 張'], ['10', '10 張'], ['15', '15 張']], String(options.chunkSize));
        const error = node('p', '', body); error.setAttribute('role', 'alert');
        async function begin(onlyType, restart = false) {
            try {
                preferred = { ...options, goal: goal.value, familiarity: familiarity.value, direction: dir.value, scope: scope.value, types: onlyType ? [onlyType] : Object.keys(types).filter(k => types[k].checked), grading: grading.value, retype: retype.checked, shuffle: shuffle.checked, audio: audio.checked, sound: sound.checked, chunkSize: Number(chunk.value) };
                if (onlyType === 'spell' && !('speechSynthesis' in window)) throw new Error('此瀏覽器不支援朗讀，請使用 Write。');
                if (restart) study = await saveStudy(deck.id, study, newEvent('reset', { generation: id() }));
                const next = createSession(deck, study, preferred); await persist(null, next); session = next; phase = 'learn'; dialog.close(); render();
            } catch (e) { error.textContent = e.message; }
        }
        const actions = node('div', null, body, 'vocab-toolbar'); button('開始 Learn', actions, () => begin(), 'vocab-primary');
        button('Write', actions, () => begin('written')); button('Spell', actions, () => begin('spell'));
        if (Object.keys(projectStudy(study).facts).length) button('重設 Learn 進度', body, () => { const confirm = node('div', null, body, 'vocab-reset-confirm'); node('p', '重設會重新學習這組字卡，歷史作答紀錄仍會保留。', confirm); button('確認重設並開始', confirm, () => begin(null, true), 'vocab-primary'); });
    }
    async function persist(event, snapshot) {
        safeOwner();
        const deckId = deck.id;
        if (snapshot) snapshot.updatedAt = Math.max(Date.now(), snapshot.updatedAt || 0, (study.sessions?.[snapshot.mode]?.updatedAt || 0) + 1);
        study = await saveStudy(deckId, study, event, snapshot); safeOwner();
    }
    function studyHeader(mode, settingsAction) {
        const h = heading(mode, { label: deck.title, action: () => { stop(); phase = 'detail'; render(); } });
        button('設定', h, settingsAction); return h;
    }
    function learnProgress() {
        const p = sessionProgress(session), goal = session.options.goal === 'quick' ? 1 : 2;
        const earned = session.order.reduce((n, key) => n + Math.min(goal, session.facts[key].stage), 0), target = p.total * goal;
        const row = node('div', null, host, 'vocab-progress-row'); node('strong', earned, row, 'vocab-progress-count');
        const progress = node('div', null, row, 'vocab-learn-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Learn 學習進度'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(target)); progress.setAttribute('aria-valuenow', String(earned));
        const segments = Math.min(24, Math.ceil(target / session.options.chunkSize));
        const segmentSize = segments === 24 ? target / segments : session.options.chunkSize;
        for (let i = 0; i < segments; i++) {
            const segment = node('span', null, progress), fill = node('i', null, segment);
            const width = `${Math.max(0, Math.min(1, (earned - i * segmentSize) / Math.min(segmentSize, target - i * segmentSize))) * 100}%`;
            fill.style.width = progressWidths[i] || width;
            requestAnimationFrame(() => { fill.style.width = width; });
        }
        node('strong', target, row, 'vocab-progress-count');
        const roundComplete = session.active.filter(k => session.facts[k].stage >= (session.chunkGoals?.[k] || session.chunkTarget)).length;
        node('p', `第 ${session.round} 輪 · 本組 ${roundComplete}／${session.active.length} · ${p.mastered}／${p.total} 已精熟`, host, 'vocab-round-state');
    }
    async function answer(response) {
        if (session.options.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); void audioContext.resume(); } catch {} }
        let next = submitAnswer(session, deck, response); if (next === session) return;
        const q = next.current, card = deck.cards.find(c => c.id === q.cardId);
        if (session.options.grading === 'relaxed' && !next.feedback.correct && ['written', 'spell'].includes(q.type) && String(response).trim()) {
            report('批改中…');
            try { if (await semanticGrade({ prompt: promptFor(card, q.direction), expected: answerFor(card, q.direction), response: String(response), aliases: answersFor(card, q.direction) })) next = overrideCorrect(next); }
            catch { report('語意批改暫時無法使用，已使用嚴格批改。'); }
        }
        const event = newEvent('answer', { cardId: card.id, revision: card.revision, direction: q.direction, correct: next.feedback.correct, response: next.feedback.response.slice(0, 4000), type: q.type,
            ordinal: next.ordinal, initialStage: Math.min(1, next.feedback.before.stage), sessionId: next.id, generation: next.generation, responseTimeMs: Math.max(0, Date.now() - questionAt) });
        next.feedback.eventId = event.id; await persist(event, next); session = next; render();
        if (session.options.sound) soundFeedback(next.feedback.correct);
        if (next.feedback.correct) timer = setTimeout(() => { if (phase === 'learn' && !host.hidden && !dialog.open) void action(() => nextLearn()); }, 950);
    }
    async function nextLearn() { const next = advanceSession(session, deck); if (next === session) return; await persist(null, next); session = next; render(); }
    function renderLearn() {
        studyHeader('Learn', () => settings()); learnProgress();
        if (session.completed || session.checkpoint) { renderCheckpoint(); return; }
        const q = session.current, card = deck.cards.find(c => c.id === q.cardId), feedback = session.feedback;
        questionAt = feedback ? questionAt : Date.now();
        const panel = node('section', null, host, `vocab-question ${feedback ? feedback.correct ? 'is-correct' : 'is-wrong' : ''}`);
        const top = node('div', null, panel, 'vocab-question-top'); node('span', q.direction === 'term' ? '解釋' : '單字', top, 'vocab-muted'); starButton(card, top);
        if (!feedback && session.facts[q.key].wrong) node('span', '再次練習', top, 'vocab-retry-label');
        icon('◖))', '朗讀題目', top, () => speak(q.type === 'spell' ? answerFor(card, q.direction) : promptFor(card, q.direction), q.type === 'spell' ? q.direction : q.direction === 'term' ? 'definition' : 'term'));
        if (q.type === 'spell') { node('h2', '聽寫', panel); button('播放單字', panel, () => speak(answerFor(card, q.direction), q.direction)); }
        else text(promptFor(card, q.direction), panel, 'vocab-prompt');
        const hint = node('p', typeLabels[q.type], panel, 'vocab-question-hint');
        if (feedback) { hint.textContent = feedback.correct ? '✓ 答對了' : '再練一次'; hint.className += feedback.correct ? ' success' : ' error'; hint.setAttribute('role', 'status'); }
        if (q.type === 'choice') {
            const choices = node('div', null, panel, 'vocab-choices');
            if (q.choices.some(value => value.length > 65)) choices.classList.add('long-choices');
            q.choices.forEach((value, i) => {
                const correctOption = gradeAnswer(value, answersFor(card, q.direction)), selected = feedback?.response === value;
                const b = button('', choices, () => feedback ? correctOption && nextLearn() : answer(value), 'vocab-choice'); node('span', feedback && correctOption ? '✓' : feedback && selected ? '×' : i + 1, b, 'vocab-choice-key'); text(value, b);
                if (feedback) { b.classList.toggle('correct-option', correctOption); b.classList.toggle('selected-correct', feedback.correct && selected); b.classList.toggle('wrong-option', !feedback.correct && selected); b.disabled = !correctOption; }
            });
        } else if (q.type === 'multi') {
            const choices = node('div', null, panel, 'vocab-choices'); const selected = new Set();
            q.choices.forEach((value, i) => { const correct = q.correctAnswers.includes(value); const l = node('label', null, choices, `vocab-choice ${feedback && correct ? 'correct-option' : ''}`); const c = node('input', null, l); c.type = 'checkbox'; c.disabled = !!feedback; c.setAttribute('aria-label', value); node('span', i + 1, l, 'vocab-choice-key'); text(value, l); c.onchange = () => c.checked ? selected.add(value) : selected.delete(value); if (feedback) c.checked = JSON.parse(feedback.response || '[]').includes(value); });
            if (!feedback) button('確認答案', panel, () => answer([...selected]), 'vocab-primary');
        } else if (q.type === 'written' || q.type === 'spell') {
            if (!feedback) {
                const form = node('form', null, panel, 'vocab-answer-form'); const input = field('你的答案', form); input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 4000; input.placeholder = '輸入答案';
                const b = node('button', '確認答案', form, 'vocab-button vocab-primary'); b.type = 'submit';
                form.onsubmit = e => { e.preventDefault(); if (!input.value.trim()) return; void action(() => answer(input.value)); };
            if (!host.hidden) input.focus({ preventScroll: true });
            } else if (!feedback.correct) { node('p', '你的答案', panel, 'vocab-muted'); text(feedback.response || '（未作答）', panel, 'vocab-incorrect-answer'); }
        } else if (q.type === 'truefalse') {
            text(q.statement, panel, 'vocab-statement');
            if (!feedback) { const choices = node('div', null, panel, 'vocab-choices'); button('是', choices, () => answer(true), 'vocab-choice'); button('否', choices, () => answer(false), 'vocab-choice'); }
        } else if (q.type === 'flash') {
            const reveal = button('查看答案', panel, () => { reveal.hidden = true; text(answerFor(card, q.direction), panel, 'vocab-revealed-answer'); const ratings = node('div', null, panel, 'vocab-ratings'); button('還在學習', ratings, () => answer(false)); button('知道了', ratings, () => answer(true), 'vocab-primary'); });
            if (feedback) reveal.hidden = true;
        }
        if (!feedback) button('不知道', panel, () => answer(q.type === 'multi' ? [] : q.type === 'truefalse' ? !q.truth : q.type === 'flash' ? false : ''), 'vocab-dontknow');
        if (feedback) {
            if (!feedback.correct && q.type !== 'choice' && q.type !== 'multi') { node('p', '正確答案', panel, 'vocab-muted'); text(feedback.expected, panel, 'vocab-correct-answer'); }
            const footer = node('div', null, panel, 'vocab-feedback');
            if (!feedback.correct && ['written', 'spell'].includes(q.type)) {
                button('我的答案其實正確', footer, async () => { const next = overrideCorrect(session); await persist(newEvent('override', { originalId: feedback.eventId, correct: true }), next); session = next; render(); }, 'vocab-link');
                if (!feedback.retyped) {
                    const form = node('form', null, footer, 'vocab-answer-form'); const correction = field('重打正確答案', form); correction.autocomplete = 'off'; correction.spellcheck = false;
                    const check = node('button', '確認訂正', form, 'vocab-button vocab-primary'); check.type = 'submit';
                    const status = node('p', '', form); status.setAttribute('role', 'status');
                    form.onsubmit = e => { e.preventDefault(); void action(async () => { if (!gradeAnswer(correction.value, answersFor(card, q.direction))) { status.textContent = '請輸入畫面上的正確答案。'; return; } const next = clone(session); next.feedback.retyped = true; next.updatedAt = Date.now(); await persist(newEvent('repair', { cardId: card.id, direction: q.direction, originalId: feedback.eventId }), next); session = next; await nextLearn(); }); };
                    correction.focus({ preventScroll: true });
                }
            }
            if (feedback.retyped) { node('p', feedback.correct ? '按 Enter 繼續' : q.type === 'choice' ? '點正確答案或按 Enter 繼續' : '按 Enter 繼續', footer, 'vocab-muted'); button('繼續', footer, () => nextLearn(), 'vocab-primary'); }
        }
        if (!feedback && (session.options.audio || q.type === 'spell')) timer = setTimeout(() => { if (!host.hidden && !dialog.open) speak(q.type === 'spell' ? answerFor(card, q.direction) : promptFor(card, q.direction), q.type === 'spell' ? q.direction : q.direction === 'term' ? 'definition' : 'term'); }, 120);
    }
    function renderCheckpoint() {
        const panel = node('section', null, host, 'vocab-checkpoint');
        const p = sessionProgress(session); const ring = node('div', `${p.percent}%`, panel, 'vocab-completion-ring'); ring.style.setProperty('--progress', `${p.percent * 3.6}deg`);
        node('h2', session.completed ? '本次學習完成' : '本輪完成', panel); stats(panel, p);
        const answers = session.roundAnswers, right = answers.filter(a => a.correct).length;
        node('p', `本輪答對 ${right} 題 · 答錯 ${answers.length - right} 題`, panel, 'vocab-muted');
        const missed = [...new Set(answers.filter(a => !a.correct).map(a => a.cardId))];
        if (missed.length) { node('h3', '本輪曾答錯的單字', panel); const list = node('div', null, panel, 'vocab-missed'); for (const cardId of missed) { const card = deck.cards.find(c => c.id === cardId); const row = node('div', null, list); text(card.term, row); text(card.definition, row); } }
        const studied = [...new Set(answers.map(a => a.cardId))];
        if (studied.length) {
            const details = node('details', null, panel, 'vocab-round-terms'); node('summary', `本輪練習的 ${studied.length} 張字卡`, details); details.open = !missed.length;
            const list = node('div', null, details, 'vocab-missed');
            for (const cardId of studied) {
                const card = deck.cards.find(c => c.id === cardId), row = node('div', null, list); text(card.term, row); text(card.definition, row);
                const actions = node('div', null, row, 'vocab-round-actions'); starButton(card, actions);
                icon('◖))', '朗讀單字', actions, () => speak(card.term, 'term'));
            }
        }
        if (!session.completed) { button('繼續下一輪', panel, nextRound, 'vocab-primary'); node('p', '按任意字元鍵繼續', panel, 'vocab-muted'); }
        else { button('返回字卡集', panel, () => { phase = 'detail'; render(); }, 'vocab-primary'); button('再練習', panel, () => settings()); }
    }
    async function nextRound() { const next = continueRound(session, deck); await persist(null, next); session = next; render(); }
    function speak(value, side) {
        if (!window.speechSynthesis) throw new Error('此瀏覽器不支援朗讀。');
        window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(value); utterance.lang = side === 'term' ? deck.termLanguage : deck.definitionLanguage; utterance.rate = 0.9; window.speechSynthesis.speak(utterance);
    }
    function soundFeedback(correct) {
        if (!audioContext || host.hidden) return;
        try {
            const start = audioContext.currentTime;
            (correct ? [523, 659, 784] : [220, 185]).forEach((frequency, i) => {
                const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0, start + i * .055); gain.gain.linearRampToValueAtTime(.035, start + i * .055 + .015); gain.gain.exponentialRampToValueAtTime(.001, start + i * .055 + .13);
                oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(start + i * .055); oscillator.stop(start + i * .055 + .15);
            });
        } catch {}
    }
    async function startFlash(options = {}, fresh = false) {
        const saved = study.sessions?.flash;
        if (!fresh && saved?.deckRevision === deck.revision && !saved.completed && !Object.keys(options).length) flash = clone(saved);
        else {
            const projected = projectStudy(study), settings = { direction: 'definition', shuffle: false, track: false, scope: 'all', audio: false, ...options };
            const cards = deck.cards.filter(c => settings.scope === 'all' || settings.scope === 'starred' && projected.stars[c.id] || settings.scope === 'learning' && !projected.flash[factKey(c.id, settings.direction)]?.known);
            if (!cards.length) throw new Error('這個範圍沒有可練習的字卡。');
            flash = { id: id(), mode: 'flash', deckId: deck.id, deckRevision: deck.revision, options: settings, order: settings.shuffle ? shuffled(cards.map(c => c.id)) : cards.map(c => c.id), index: 0, ratings: {}, flipped: false, playing: false, completed: false, updatedAt: Date.now() };
        }
        flash.playing = false; phase = 'flash'; await persist(null, flash); render();
    }
    function flashSettings() {
        const body = modal('Flashcards 設定');
        const dir = select('正面顯示', body, [['definition', '單字'], ['term', '解釋']], flash.options.direction);
        const scope = select('練習範圍', body, [['all', '全部'], ['starred', '已標星號'], ['learning', '還在學習']], flash.options.scope);
        const track = check('追蹤進度', body, flash.options.track), shuffle = check('打亂順序', body, flash.options.shuffle), audio = check('朗讀卡片', body, flash.options.audio);
        button('儲存並開始', body, async () => { await startFlash({ direction: dir.value, scope: scope.value, track: track.checked, shuffle: shuffle.checked, audio: audio.checked }, true); dialog.close(); }, 'vocab-primary');
    }
    async function saveFlash() { flash.updatedAt = Date.now(); await persist(null, flash); }
    async function flip() { flash.flipped = !flash.flipped; await saveFlash(); updateFlip(); }
    function updateFlip() {
        const stage = host.querySelector('.vocab-flip'); if (!stage) return;
        stage.classList.toggle('flipped', flash.flipped); stage.setAttribute('aria-label', flash.flipped ? '查看正面' : '查看背面');
        stage.querySelector('.front').setAttribute('aria-hidden', String(flash.flipped)); stage.querySelector('.back').setAttribute('aria-hidden', String(!flash.flipped));
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        if (flash.options.audio) speak(flash.flipped ? answerFor(card, flash.options.direction) : promptFor(card, flash.options.direction), flash.flipped ? flash.options.direction : flash.options.direction === 'term' ? 'definition' : 'term');
    }
    async function rateFlash(known) {
        if (flash.completed) return;
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        const stage = host.querySelector('.vocab-flip'); stage?.classList.add(known ? 'swipe-known' : 'swipe-learning');
        const event = newEvent('flash', { cardId: card.id, direction: flash.options.direction, revision: card.revision, correct: known, sessionId: flash.id });
        const next = clone(flash); next.ratings[card.id] = known; next.index++; next.flipped = false; next.completed = next.index >= next.order.length; next.updatedAt = Date.now(); next.playing = false;
        await persist(event, next); await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 210)); flash = next; render();
    }
    async function moveFlash(shift) {
        const dest = flash.index + shift; if (dest < 0) return;
        flash.index = Math.min(flash.order.length, dest); flash.completed = dest >= flash.order.length; flash.flipped = false; await saveFlash(); render();
    }
    function renderFlash() {
        studyHeader('Flashcards', () => flashSettings());
        const known = Object.values(flash.ratings).filter(Boolean).length, learning = Object.values(flash.ratings).filter(v => !v).length;
        if (flash.completed) {
            const panel = node('section', null, host, 'vocab-checkpoint'); node('h2', '本輪字卡完成', panel); node('p', flash.options.track ? `知道了 ${known} 張 · 還在學習 ${learning} 張` : `已瀏覽 ${flash.order.length} 張字卡`, panel);
            if (learning) button(`再練還在學習的 ${learning} 張`, panel, async () => { const next = clone(flash); next.order = next.order.filter(cardId => next.ratings[cardId] === false); next.ratings = {}; next.index = 0; next.completed = false; next.updatedAt = Date.now(); await persist(null, next); flash = next; render(); }, 'vocab-primary');
            button('在 Learn 中練習', panel, () => settings()); button('重新開始 Flashcards', panel, () => startFlash(flash.options, true)); button('返回字卡集', panel, () => { phase = 'detail'; render(); }); return;
        }
        const toolbar = node('div', null, host, 'vocab-flash-top');
        const tracking = check('追蹤進度', toolbar, flash.options.track);
        tracking.onchange = () => action(async () => { flash.options.track = tracking.checked; await saveFlash(); render(); });
        if (flash.options.track) { node('span', `還在學習 ${learning}`, toolbar, 'error'); node('span', `知道了 ${known}`, toolbar, 'success'); }
        const card = deck.cards.find(c => c.id === flash.order[flash.index]); const actions = node('div', null, toolbar, 'vocab-toolbar'); starButton(card, actions);
        icon('◖))', '朗讀卡片', actions, () => speak(flash.flipped ? answerFor(card, flash.options.direction) : promptFor(card, flash.options.direction), flash.flipped ? flash.options.direction : flash.options.direction === 'term' ? 'definition' : 'term'));
        const stage = node('button', null, host, 'vocab-flip'); stage.type = 'button'; stage.setAttribute('aria-label', '查看背面'); stage.onclick = () => action(flip);
        const faces = node('div', null, stage, 'vocab-flip-inner');
        for (const side of ['front', 'back']) { const face = node('div', null, faces, 'vocab-face ' + side); node('span', side === 'front' ? '正面' : '背面', face, 'vocab-face-label'); text(side === 'front' ? promptFor(card, flash.options.direction) : answerFor(card, flash.options.direction), face); node('span', '點擊或按空白鍵翻面', face, 'vocab-face-help'); }
        updateFlip(); let down = null;
        stage.onpointerdown = e => { down = [e.clientX, e.clientY]; }; stage.onpointerup = e => { if (!down || !flash.options.track) return; const delta = e.clientX - down[0]; if (Math.abs(delta) > 70 && Math.abs(e.clientY - down[1]) < 100) { stage.onclick = null; void action(() => rateFlash(delta > 0)); } down = null; };
        if (flash.options.track) { const ratings = node('div', null, host, 'vocab-ratings'); button('← 還在學習', ratings, () => rateFlash(false), 'vocab-learning'); button('知道了 →', ratings, () => rateFlash(true), 'vocab-known'); }
        const controls = node('div', null, host, 'vocab-flash-controls');
        const prev = icon('←', '上一張字卡', controls, () => moveFlash(-1)); prev.disabled = flash.index === 0;
        node('span', `${flash.index + 1}／${flash.order.length}`, controls); icon('→', '下一張字卡', controls, () => moveFlash(1));
        const play = button(flash.playing ? '暫停' : '自動播放', controls, async () => { flash.playing = !flash.playing; await saveFlash(); render(); }); play.setAttribute('aria-pressed', String(flash.playing));
        button('打亂', controls, async () => { flash.order = shuffled(flash.order); flash.index = 0; flash.flipped = false; flash.completed = false; await saveFlash(); render(); });
        const bar = node('progress', null, host, 'vocab-flash-progress'); bar.max = flash.order.length; bar.value = flash.index; bar.setAttribute('aria-label', '字卡瀏覽進度');
        node('p', flash.options.track ? '空白鍵翻面 · ← 還在學習 · → 知道了 · Backspace 返回上一張' : '空白鍵翻面 · ← 上一張 · → 下一張', host, 'vocab-key-help');
        if (flash.playing) timer = setTimeout(() => { if (host.hidden || dialog.open || phase !== 'flash') return; void action(async () => { if (!flash.flipped) { await flip(); timer = setTimeout(() => { if (!host.hidden && !dialog.open) void action(() => moveFlash(1)); }, 2200); } else await moveFlash(1); }); }, 2200);
    }
    window.addEventListener('flashcard-sync', ({ detail }) => {
        if (detail.uid !== owner) return;
        if (detail.error) { report(detail.error); if (detail.conflict) { conflict = true; host.dataset.conflictDeck = detail.deckId; render(); } }
    });
    window.addEventListener('sync-status', async ({ detail }) => {
        if (!owner || host.hidden || auth.currentUser?.uid !== owner) return;
        if (!detail.error && detail.pending === 0 && !conflict) report('資料已同步');
    });
    new MutationObserver(() => { if (host.hidden) stop(); }).observe(host, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    document.addEventListener('keydown', e => {
        if (host.hidden || !owner || dialog.open || document.querySelector('dialog[open]') || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        if (e.target.matches('input, textarea, select, [contenteditable]')) return;
        if (phase === 'flash' && !flash.completed) {
            if (e.key === ' ') { e.preventDefault(); void action(flip); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); void action(() => flash.options.track ? rateFlash(e.key === 'ArrowRight') : moveFlash(e.key === 'ArrowRight' ? 1 : -1)); }
            if (e.key === 'Backspace') { e.preventDefault(); void action(() => moveFlash(-1)); }
        } else if (phase === 'learn' && session.feedback?.retyped && (e.key === 'Enter' || e.key === ' ' || !session.feedback.correct && e.key.length === 1)) { e.preventDefault(); void action(nextLearn); }
        else if (phase === 'learn' && session.checkpoint && !session.completed && (e.key === 'Enter' || e.key === ' ' || e.key.length === 1)) { e.preventDefault(); void action(nextRound); }
        else if (phase === 'learn' && !session.feedback && session.current?.type === 'choice' && /^[1-4]$/.test(e.key)) { const value = session.current.choices[Number(e.key) - 1]; if (value) { e.preventDefault(); void action(() => answer(value)); } }
    });
    dialog.addEventListener('close', () => { if (phase === 'flash' && flash?.playing) { flash.playing = false; render(); } });
    return {
        async open() {
            const ticket = ++operation; owner = auth.currentUser?.uid || null; activate();
            if (!owner) { phase = 'list'; render(); return; }
            if (phase !== 'list' && deck && decks[deck.id]) { render(); return; }
            phase = 'list'; message = '載入字卡集…'; render();
            try { const result = await loadDecks(); safeOwner(); if (ticket !== operation) return; decks = result.decks; message = result.error || (result.pending ? `${result.pending} 筆等待同步` : ''); render(); } catch (e) { report(e.message); }
        },
        resetForUser(uid) { if (uid === owner) return; operation++; stop(); clearTimeout(draftTimer); dialog.close(); owner = uid || null; decks = {}; deck = null; study = {}; session = null; flash = null; draft = null; phase = 'list'; message = ''; conflict = false; preferred = { ...DEFAULT_OPTIONS }; direction = 'term'; search = ''; termFilter = 'all'; termQuery = ''; screen = ''; if (!host.hidden) void this.open(); }
    };
}
