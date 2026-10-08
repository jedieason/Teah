import { gradeEquivalence } from './equivalence.js';
import { GRADING_LEVELS, gradingOptions, gradingLevel } from './grading-options.js';
import { resetEquivalence } from './equivalence-client.js';
import { auth } from '../../services/firebase.js';
import { DEFAULT_OPTIONS, LEARN_VERSION, MAX_CARDS, id, clone, normalize, parseImport, FLASHCARD_IMPORT_PROMPT, shuffled, projectStudy, progressCounts, createSession, submitAnswer, overrideCorrect, advanceSession, continueRound, sessionProgress, roundDone, writingHint, writingSymbols, spellingFeedback, gradingFor, activityName, factKey, promptFor, answerFor, answersFor, gradeAnswer } from './model.js';
import { loadDecks, saveDeck, loadStudy, saveStudy, newEvent, saveDraft, readDraft, clearDraft, changeDeleted, discardConflicts, flushOutbox, generateDeck, editDeckWithAI } from './service.js';
import { sourceQuestions, MAX_GENERATION_INSTRUCTIONS } from './generation.js';
import { editingBatches } from './editing.js';
import { isMobileFlash, bindMobileFlashSwipe, animateMobileFlashExit, resetMobileFlashSwipe } from './mobile-swipe.js';
const node = (tag, text, parent, className) => {
    const e = document.createElement(tag); if (text != null) e.textContent = text;
    if (className) e.className = className; parent?.append(e); return e;
};
const languages = [['en-US', 'English'], ['zh-TW', '繁體中文'], ['ms-MY', '馬來文（Bahasa Melayu）'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['es-ES', 'Español'], ['it-IT', 'Italiano'], ['la', 'Latin'], ['math', '數學／化學符號']];
const typeLabels = { choice: '選擇題', multi: '複選題', written: '書寫／填空題', flash: '字卡', truefalse: '是非題', spell: '聽寫題' };
const studyIcons = {
    cards: '<rect x="6" y="5" width="15" height="13" rx="3.5" fill="var(--v-card-back,#4cd9ff)" stroke="none"/><rect x="2" y="1" width="15" height="13" rx="3.5" fill="currentColor" stroke="none"/>',
    learn: '<path d="M18 4a9 9 0 1 0 3 12"/><path d="m18 4 3 1-1 3M21 11v1"/>',
    settings: '<path d="m10 3-.6 2.3-2 .9L5.3 5.5 3 9.5l1.6 1.6v2L3 14.5l2.3 4 2.1-.7 2 .9L10 21h4l.6-2.3 2-.9 2.1.7 2.3-4-1.6-1.4v-2L21 9.5l-2.3-4-2.1.7-2-.9L14 3Z"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    left: '<path d="m14 5-7 7 7 7M7 12h14"/>', right: '<path d="m10 5 7 7-7 7M3 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>', shuffle: '<path d="M4 20L20 4M14.5 4h5.5v5.5M4 4l5 5M15 15l5 5M14.5 20h5.5v-5.5"/>',
    play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>', pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    undo: '<path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12"/>', edit: '<path d="m16 3 5 5L8 21H3v-5Z"/>',
    audio: '<path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
};
studyIcons.star = '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>';
export function mountFlashcard({ host, activate }) {
    let owner = null, decks = {}, deck = null, study = {}, phase = 'list', draft = null, session = null, flash = null;
    let message = '', conflict = false, operation = 0, busy = false, timer = null, speechTimer = null, draftTimer = null, questionAt = Date.now(), trash = false;
    let preferred = { ...DEFAULT_OPTIONS, defaultLanguage: navigator.language || 'zh-TW' }, direction = 'term', search = '';
    let screen = '', termFilter = 'all', termQuery = '';
    let audioContext, progressWidths = [], questionKey = '', symbolsKey = '', symbols = [];
    let speechGeneration = 0, pendingVoiceLoad = null, speechError = '';
    let generation = null, savingGeneration = false;
    const backgroundInert = new Map();
    const dialog = node('dialog', null, document.body, 'vocab-dialog');
    window.speechSynthesis?.getVoices?.();
    function report(text) { message = text; const status = host.querySelector('.vocab-status'); if (status) status.textContent = text; }
    function reportSpeechError(text) { speechError = text; report(text); }
    function stopSpeech() { speechGeneration++; pendingVoiceLoad?.(); pendingVoiceLoad = null; window.speechSynthesis?.cancel(); }
    function stop() { clearTimeout(timer); timer = null; clearTimeout(speechTimer); speechTimer = null; stopSpeech(); }
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
    function studyIcon(name, label, parent, work, cls = '') {
        const b = icon('', label, parent, work); b.className += ' ' + cls;
        b.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${studyIcons[name]}</svg>`;
        return b;
    }
    function toggle(label, parent, checked, work) {
        const input = check(label, parent, checked); input.parentElement.classList.add('vocab-toggle');
        input.onchange = () => action(() => work(input.checked)); return input;
    }
    function pill(label, name, parent, checked, work) {
        const input = check(label, parent, checked); input.parentElement.classList.add('vocab-option-pill');
        const glyph = node('span', null, null, 'vocab-pill-glyph'); glyph.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${studyIcons[name]}</svg>`;
        input.parentElement.prepend(glyph);
        if (work) input.onchange = () => action(() => work(input.checked));
        return input;
    }
    function field(label, parent, value = '', type = 'input') {
        const l = node('label', null, parent, 'vocab-field'); node('span', label, l);
        const input = node(type, null, l); input.setAttribute('aria-label', label); input.value = value; return input;
    }
    function select(label, parent, values, value) {
        const isToolbar = parent?.classList?.contains('vocab-toolbar') || parent?.classList?.contains('vocab-import-controls');
        const wrap = node('div', null, parent, isToolbar ? 'vocab-field' : 'vocab-field vocab-field-row');
        node('span', label, wrap, 'vocab-field-label');
        const container = node('div', null, wrap, 'vocab-dropdown');

        const hiddenSelect = node('select', null, container, 'vocab-hidden-select');
        hiddenSelect.tabIndex = -1;
        hiddenSelect.setAttribute('aria-hidden', 'true');
        hiddenSelect.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:0;height:0;margin:0;padding:0;border:0;';
        for (const [v, text] of values) {
            const o = node('option', text, hiddenSelect);
            o.value = String(v);
        }

        const trigger = node('button', null, container, 'vocab-dropdown-trigger');
        trigger.type = 'button';
        trigger.setAttribute('aria-label', label);
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');

        const labelSpan = node('span', '', trigger, 'vocab-dropdown-label');
        const chevron = node('span', null, trigger, 'vocab-dropdown-chevron');
        chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${studyIcons.chevron}</svg>`;

        const menu = node('div', null, container, 'vocab-dropdown-menu');
        menu.setAttribute('role', 'listbox');

        let currentValue = String(value ?? (values[0] ? values[0][0] : ''));
        let changeHandler = null;

        const closeMenu = () => {
            container.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        };

        const updateUI = (val) => {
            currentValue = String(val);
            hiddenSelect.value = currentValue;
            const match = values.find(([v]) => String(v) === currentValue) || values[0];
            labelSpan.textContent = match ? match[1] : currentValue;
            menu.querySelectorAll('.vocab-dropdown-item').forEach(b => {
                const isSelected = b.dataset.value === currentValue;
                b.classList.toggle('selected', isSelected);
                b.setAttribute('aria-selected', String(isSelected));
            });
        };

        trigger.onclick = e => {
            e.stopPropagation();
            if (trigger.disabled) return;
            document.querySelectorAll('.vocab-dropdown.open').forEach(d => {
                if (d !== container) {
                    d.classList.remove('open');
                    d.querySelector('.vocab-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
                }
            });
            const isOpen = container.classList.toggle('open');
            trigger.setAttribute('aria-expanded', String(isOpen));
        };

        values.forEach(([v, text]) => {
            const item = node('button', null, menu, 'vocab-dropdown-item');
            item.type = 'button';
            item.dataset.value = String(v);
            item.setAttribute('role', 'option');
            node('span', text, item, 'vocab-dropdown-item-label');
            const checkIcon = node('span', null, item, 'vocab-dropdown-item-check');
            checkIcon.setAttribute('aria-hidden', 'true');
            checkIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${studyIcons.check}</svg>`;
            item.onclick = e => {
                e.stopPropagation();
                closeMenu();
                if (currentValue !== String(v)) {
                    updateUI(v);
                    if (typeof changeHandler === 'function') {
                        changeHandler.call(wrap, { target: wrap });
                    }
                    wrap.dispatchEvent(new Event('change', { bubbles: true }));
                    hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };
        });

        const onDocClick = e => {
            if (!container.isConnected) {
                document.removeEventListener('pointerdown', onDocClick);
                return;
            }
            if (!container.contains(e.target)) {
                closeMenu();
            }
        };
        document.addEventListener('pointerdown', onDocClick);

        container.addEventListener('keydown', e => {
            if (e.key === 'Escape' && container.classList.contains('open')) {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                trigger.focus();
            }
        });

        hiddenSelect.addEventListener('change', () => {
            if (hiddenSelect.value !== currentValue) {
                updateUI(hiddenSelect.value);
                if (typeof changeHandler === 'function') {
                    changeHandler.call(wrap, { target: wrap });
                }
                wrap.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        updateUI(currentValue);

        Object.defineProperty(wrap, 'value', {
            get: () => currentValue,
            set: (v) => {
                updateUI(v);
            }
        });

        Object.defineProperty(wrap, 'onchange', {
            get: () => changeHandler,
            set: (fn) => {
                changeHandler = fn;
            }
        });

        Object.defineProperty(wrap, 'disabled', {
            get: () => trigger.disabled,
            set: (val) => {
                trigger.disabled = Boolean(val);
                hiddenSelect.disabled = Boolean(val);
                if (val) closeMenu();
            }
        });

        return wrap;
    }
    function dropdown(label, parent, values, value, onchange) {
        const s = select(label, parent, values, value);
        if (typeof onchange === 'function') s.onchange = () => onchange(s.value);
        return s;
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
    function studyLayout() {
        const active = !host.hidden && ['flash', 'learn'].includes(phase);
        document.body.classList.toggle('vocab-studying', active);
        if (active) {
            for (const sibling of host.parentElement.children) if (sibling !== host && !backgroundInert.has(sibling)) { backgroundInert.set(sibling, sibling.inert); sibling.inert = true; }
        } else {
            for (const [element, previous] of backgroundInert) element.inert = previous;
            backgroundInert.clear();
        }
        updateStudyViewport();
    }
    const mobileStudy = () => window.matchMedia('(max-width:700px)').matches;
    function updateStudyViewport() {
        const viewport = window.visualViewport;
        const active = !host.hidden && phase === 'learn' && mobileStudy();
        host.style.setProperty('--v-study-height', active ? `${viewport?.height || window.innerHeight}px` : '100dvh');
        host.style.setProperty('--v-study-top', active ? `${viewport?.offsetTop || 0}px` : '0px');
        if (active && host.contains(document.activeElement) && document.activeElement.matches('.vocab-answer-form input')) {
            const input = document.activeElement;
            requestAnimationFrame(() => {
                if (document.activeElement !== input || !input.isConnected) return;
                const area = input.closest('.vocab-answer-area'), form = input.closest('form');
                const region = area?.offsetHeight <= host.clientHeight - 32 ? area : form.offsetHeight <= host.clientHeight - 32 ? form : input;
                region.scrollIntoView({ block: 'nearest' });
            });
        }
    }
    window.visualViewport?.addEventListener('resize', updateStudyViewport);
    window.visualViewport?.addEventListener('scroll', updateStudyViewport);
    window.addEventListener('resize', updateStudyViewport);
    function render() {
        const nextScreen = `${phase}:${deck?.id || ''}:${phase === 'learn' ? `${session?.id}:${session?.current?.key || ''}:${session?.round}:${!!session?.checkpoint}:${!!session?.completed}` : ''}`;
        const changedScreen = screen !== nextScreen;
        const nextFeedback = phase === 'learn' && session?.feedback ? session.feedback.correct ? 'correct' : 'wrong' : 'none';
        const feedbackChanged = nextFeedback !== 'none' && (host.dataset.feedback !== nextFeedback || host.dataset.ordinal !== String(session?.ordinal || 0));
        const roundTermsOpen = !changedScreen ? host.querySelector('.vocab-round-terms')?.open : undefined;
        screen = nextScreen;
        progressWidths = [...host.querySelectorAll('.vocab-learn-progress i')].map(e => e.style.width);
        stop(); host.replaceChildren();
        host.dataset.phase = phase;
        studyLayout();
        host.dataset.ordinal = phase === 'learn' ? String(session?.ordinal || 0) : '';
        host.dataset.feedback = nextFeedback;
        host.dataset.skipped = String(phase === 'learn' && !!session?.feedback?.skipped);
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
        if (phase === 'learn') renderLearn(feedbackChanged);
        if (phase === 'flash') renderFlash();
        const roundTerms = host.querySelector('.vocab-round-terms');
        if (roundTerms && roundTermsOpen !== undefined) roundTerms.open = roundTermsOpen;
        if (changedScreen || phase === 'learn' && host.querySelector('.vocab-question.is-entering')) { host.scrollTop = 0; window.scrollTo(0, 0); }
    }
    function renderList() {
        const h = heading('Flashcard'); button('＋ 建立字卡集', h, () => edit(null), 'vocab-primary');
        const toolbar = node('div', null, host, 'vocab-toolbar');
        const query = field('搜尋字卡集', toolbar, search); query.type = 'search'; query.placeholder = '字卡集名稱或內容';
        button(trash ? '返回字卡集' : '已刪除', toolbar, () => { trash = !trash; render(); });
        button('重新同步', toolbar, async () => { await flushOutbox(); const result = await loadDecks(); decks = result.decks; message = result.error || (result.pending ? `${result.pending} 筆等待同步` : ''); render(); });
        const grid = node('div', null, host, 'vocab-grid');
        function list() {
            grid.replaceChildren(); const filtered = Object.values(decks).filter(d => !!d.deletedAt === trash && normalize(d.title + ' ' + (d.authorName || '') + ' ' + d.description + ' ' + d.cards.map(c => c.term + ' ' + c.definition).join(' ')).includes(normalize(search))).sort((a, b) => b.updatedAt - a.updatedAt);
            if (!filtered.length) node('p', trash ? '沒有已刪除字卡集' : search ? '沒有符合的字卡集' : '尚無字卡集', grid, 'vocab-empty');
            for (const d of filtered) {
                const card = node('article', null, grid, 'vocab-deck');
                const open = button(d.title, card, () => openDeck(d.id), 'vocab-deck-title'); if (trash) open.disabled = true;
                if (d.authorName || d.isPublic) {
                    const authorRow = node('div', null, card, 'vocab-deck-author');
                    if (d.authorPhoto) {
                        const avatar = node('img', null, authorRow, 'vocab-author-avatar');
                        avatar.src = d.authorPhoto;
                        avatar.alt = d.authorName || '作者';
                        avatar.onerror = () => { avatar.style.display = 'none'; };
                    } else if (d.authorName) {
                        node('span', d.authorName.slice(0, 1).toUpperCase(), authorRow, 'vocab-author-avatar vocab-author-initial');
                    }
                    if (d.authorName) node('span', d.authorName, authorRow, 'vocab-author-name');
                    if (d.isPublic) node('span', '公開', authorRow, 'vocab-pill vocab-pill-public');
                }
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
    function stats(parent, counts, written = false) {
        const wrap = node('div', null, parent, 'vocab-stats');
        for (const [key, label] of written ? [['new', '尚未答對'], ['learning', '答對一次'], ['mastered', '答對兩次']] : [['new', '未學習'], ['learning', '正在學習'], ['mastered', '已精熟']]) {
            const item = node('div', null, wrap, `vocab-stat ${key}`); node('strong', counts[key], item); node('span', label, item);
        }
    }
    async function star(card) { const value = !projectStudy(study).stars[card.id]; study = await saveStudy(deck.id, study, newEvent('star', { cardId: card.id, value })); render(); }
    function starButton(card, parent) { const starred = !!projectStudy(study).stars[card.id]; const b = studyIcon('star', starred ? '取消星號' : '標記星號', parent, () => star(card)); b.classList.toggle('starred', starred); b.setAttribute('aria-pressed', String(starred)); return b; }
    function renderDetail() {
        const isAuthor = !deck.authorId || deck.authorId === owner;
        const h = heading(deck.title, { label: 'Flashcard', action: () => { phase = 'list'; deck = null; render(); } });
        if (isAuthor) {
            button('編輯字卡集', h, () => edit(deck));
            button('AI 編輯字卡', h, async () => { await edit(deck); editingDialog(); });
        }
        if (deck.authorName || deck.isPublic) {
            const authorBar = node('div', null, host, 'vocab-detail-author');
            if (deck.authorPhoto) {
                const avatar = node('img', null, authorBar, 'vocab-author-avatar');
                avatar.src = deck.authorPhoto;
                avatar.alt = deck.authorName || '作者';
                avatar.onerror = () => { avatar.style.display = 'none'; };
            } else if (deck.authorName) {
                node('span', deck.authorName.slice(0, 1).toUpperCase(), authorBar, 'vocab-author-avatar vocab-author-initial');
            }
            if (deck.authorName) node('span', `作者：${deck.authorName}`, authorBar, 'vocab-author-name');
            if (deck.isPublic) node('span', '公開字卡集', authorBar, 'vocab-pill vocab-pill-public');
        }
        if (deck.description) node('p', deck.description, host, 'vocab-description');
        const projected = projectStudy(study), counts = progressCounts(deck, projected, direction);
        const studyModes = node('div', null, host, 'vocab-modes');
        button('Flashcards', studyModes, () => startFlash(), 'vocab-mode');
        button('Learn', studyModes, () => settings(), 'vocab-mode vocab-primary');
        const saved = study.sessions?.learn;
        if (saved?.version === LEARN_VERSION && saved.deckRevision === deck.revision && saved.generation === projected.generation && !saved.completed) button('繼續 ' + activityName(saved), studyModes, () => { session = clone(saved); phase = 'learn'; render(); }, 'vocab-mode');
        const controls = node('div', null, host, 'vocab-toolbar');
        const dir = select('進度方向', controls, [['term', '看解釋 → 答單字'], ['definition', '看單字 → 答解釋'], ['both', '正反向']], direction);
        dir.onchange = () => { direction = dir.value; render(); };
        button('匯出文字', controls, () => exportText());
        if (isAuthor) {
            button('刪除字卡集', controls, async () => { decks[deck.id] = await changeDeleted(deck, true); message = '字卡集已移至「已刪除」，可隨時復原。'; deck = null; phase = 'list'; render(); });
        }
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
        draft = recovered && (!previous || recovered.baseRevision === previous.revision) ? recovered : { ...(previous ? clone(previous) : { title: '', description: '', isPublic: false, termLanguage: 'en-US', definitionLanguage: 'zh-TW', cards: Array.from({ length: 3 }, () => ({ id: id(), term: '', definition: '' })) }), baseRevision: previous?.revision || 0 };
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
        const fields = new Map(); let attemptedSave = false, invalidFields = new Set();
        const summary = node('p', '', h, 'vocab-editor-errors'); summary.setAttribute('role', 'alert'); summary.hidden = true;
        function requiredField(input, key) {
            const error = node('span', '', input.parentElement, 'vocab-field-error'); error.id = `vocab-field-error-${key}`; error.hidden = true;
            input.setAttribute('aria-describedby', error.id); fields.set(key, { input, error });
        }
        function validate(focus = false) {
            const issues = new Map();
            if (!draft.title.trim()) issues.set('title', '請填寫字卡集名稱。');
            const filled = draft.cards.filter(c => c.term.trim() || c.definition.trim());
            if (!filled.length) {
                if (draft.cards[0]) for (const key of ['term', 'definition']) issues.set(`${draft.cards[0].id}-${key}`, key === 'term' ? '請填寫單字。' : '請填寫解釋。');
            } else for (const c of filled) {
                if (!c.term.trim()) issues.set(`${c.id}-term`, '請填寫單字。');
                if (!c.definition.trim()) issues.set(`${c.id}-definition`, '請填寫解釋。');
            }
            for (const key of new Set([...invalidFields, ...issues.keys()])) {
                const entry = fields.get(key); if (!entry) continue;
                const message = issues.get(key); entry.input.setAttribute('aria-invalid', String(!!message)); entry.error.textContent = message || ''; entry.error.hidden = !message;
            }
            invalidFields = new Set(issues.keys());
            const invalid = issues.size > 0 || !filled.length;
            summary.textContent = issues.has('title') ? issues.get('title') : !filled.length ? '請至少新增一張完整字卡。' : invalid ? '請補齊標示欄位的單字或解釋。' : '';
            summary.hidden = !invalid;
            if (focus && invalid) {
                const input = fields.get(issues.keys().next().value)?.input || host.querySelector('.vocab-add');
                input?.focus({ preventScroll: true }); input?.scrollIntoView({ block: 'center' });
            }
            return !invalid;
        }
        async function save(andLearn = false) {
            attemptedSave = true; if (!validate(true)) return;
            clearTimeout(draftTimer);
            const value = { ...draft, cards: draft.cards.filter(c => c.term.trim() || c.definition.trim()) }, oldId = deck?.id;
            const next = await saveDeck(value, deck); safeOwner(); await clearDraft(oldId);
            deck = next; decks[next.id] = next; study = await loadStudy(next.id); phase = 'detail'; message = '字卡集已保存在此裝置。'; render(); if (andLearn) settings();
        }
        button('完成', h, () => save(), 'vocab-primary'); button('建立並練習', h, () => save(true));
        const meta = node('div', null, host, 'vocab-meta');
        for (const [key, label, type, max] of [['title', '字卡集名稱', 'input', 160], ['description', '說明（選填）', 'textarea', 2000]]) {
            const input = field(label, meta, draft[key], type); input.maxLength = max;
            if (key === 'title') { input.required = true; requiredField(input, key); }
            input.oninput = () => { draft[key] = input.value; if (attemptedSave) validate(); queueDraft(); };
        }
        const publicToggleWrap = node('div', null, meta, 'vocab-public-toggle-wrap');
        toggle('公開字卡集', publicToggleWrap, !!draft.isPublic, checked => { draft.isPublic = checked; queueDraft(); });
        const langs = node('div', null, host, 'vocab-toolbar');
        for (const [key, label] of [['termLanguage', '單字語言'], ['definitionLanguage', '解釋語言']]) { const s = select(label, langs, languages, draft[key]); s.onchange = () => { draft[key] = s.value; queueDraft(); }; }
        const toolbar = node('div', null, host, 'vocab-toolbar');
        const importButton = button('＋ Import', toolbar, () => importDialog(), 'vocab-import-trigger'); importButton.setAttribute('aria-label', '匯入文字');
        const aiEdit = button('AI 編輯字卡', toolbar, () => editingDialog());
        const updateAIEdit = () => { aiEdit.disabled = !draft.cards.some(c => c.term.trim() || c.definition.trim()); }; updateAIEdit();
        button('交換單字與解釋', toolbar, () => { draft.cards = draft.cards.map(c => ({ ...c, term: c.definition, definition: c.term, termAliases: c.definitionAliases || [], definitionAliases: c.termAliases || [] })); [draft.termLanguage, draft.definitionLanguage] = [draft.definitionLanguage, draft.termLanguage]; queueDraft(); render(); });
        node('span', `${draft.cards.length}／${MAX_CARDS} 張`, toolbar, 'vocab-muted');
        const list = node('div', null, host, 'vocab-editor-rows'); let dragIndex = null;
        function redraw(focusIndex) {
            list.replaceChildren();
            for (const key of fields.keys()) if (key !== 'title') fields.delete(key);
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
                    requiredField(input, `${c.id}-${key}`);
                    input.oninput = () => { c[key] = input.value; if (attemptedSave) validate(); queueDraft(); updateAIEdit(); };
                    input.onkeydown = e => {
                        if (key === 'definition' && e.key === 'Tab' && !e.shiftKey && i === draft.cards.length - 1 && draft.cards.length < MAX_CARDS) { e.preventDefault(); draft.cards.push({ id: id(), term: '', definition: '' }); queueDraft(); redraw(i + 1); }
                    };
                    const formatting = node('div', null, wrap, 'vocab-format');
                    for (const [title, marker] of [['粗體', '**'], ['斜體', '*'], ['底線', '__'], ['標示', '==']]) {
                        const b = button(title, formatting, () => { const start = input.selectionStart, end = input.selectionEnd; input.setRangeText(marker + input.value.slice(start, end) + marker, start, end, 'select'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }); b.tabIndex = -1;
                    }
                }
                const aliases = node('details', null, row, 'vocab-aliases'); node('summary', '替代答案', aliases);
                for (const [key, label] of [['termAliases', '單字替代答案（每行一個）'], ['definitionAliases', '解釋替代答案（每行一個）']]) {
                    const a = field(label, aliases, (c[key] || []).join('\n'), 'textarea'); a.rows = 2; a.oninput = () => { c[key] = a.value.split('\n').filter(Boolean); queueDraft(); };
                }
                button('＋ 插入下一張', row, () => { if (draft.cards.length >= MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張。`); draft.cards.splice(i + 1, 0, { id: id(), term: '', definition: '' }); queueDraft(); redraw(i + 1); }, 'vocab-insert');
            });
            if (attemptedSave) validate(); updateAIEdit();
            if (focusIndex != null) list.querySelector(`[data-index="${focusIndex}"] textarea`)?.focus();
        }
        redraw(); button('＋ 新增字卡', host, () => { if (draft.cards.length >= MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張。`); draft.cards.push({ id: id(), term: '', definition: '' }); queueDraft(); redraw(draft.cards.length - 1); }, 'vocab-add');
        button('儲存字卡集', host, () => save(), 'vocab-primary vocab-save-bottom');
    }
    function modal(title, variant = '') {
        stop();
        if (dialog.open) {
            try { dialog.close(); } catch (err) { console.warn('[FlashcardGen] dialog.close warning:', err); }
        }
        dialog.className = 'vocab-dialog' + (variant ? ' ' + variant : ''); dialog.replaceChildren(); dialog.setAttribute('aria-label', title);
        const h = node('header', null, dialog, 'vocab-heading'); node('h2', title, h); icon('×', '關閉對話框', h, () => dialog.close());
        const body = node('div', null, dialog, 'vocab-dialog-body'); dialog.showModal(); return body;
    }
    function generationDialog(sources) {
        console.log('[FlashcardGen] 開啟 AI 生成字卡對話框，素材數：', sources.length);
        const body = modal('AI 生成字卡', 'vocab-generation-dialog');
        node('p', `來源：${sources.length} 題待複習錯題`, body, 'vocab-muted');
        const form = node('form', null, body, 'vocab-generation-form');
        const instructions = field('生成指令（選填）', form, '', 'textarea');
        instructions.rows = 6; instructions.maxLength = MAX_GENERATION_INSTRUCTIONS;
        instructions.placeholder = '例如：以問答呈現，只整理判讀步驟與容易混淆的觀念，答案用條列。';
        const status = node('p', '', form, 'vocab-generation-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const controls = node('div', null, form, 'vocab-toolbar vocab-dialog-actions');
        const cancel = node('button', '取消', controls, 'vocab-button'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        const submit = node('button', '生成字卡', controls, 'vocab-button vocab-primary'); submit.type = 'submit';
        form.onsubmit = async event => {
            event.preventDefault();
            console.log('[FlashcardGen] 提交生成字卡表單', { sourcesCount: sources.length, instructions: instructions.value });
            if (generation || busy) return;
            const controller = new AbortController(), generationOwner = owner;
            generation = controller; submit.disabled = instructions.disabled = true; form.setAttribute('aria-busy', 'true');
            status.textContent = '正在生成字卡…';
            const timeout = setTimeout(() => controller.abort(), 90000);
            try {
                safeOwner();
                const generated = await generateDeck(sources, instructions.value, controller.signal);
                console.log('[FlashcardGen] AI 生成成功，開始儲存字卡集', generated.title);
                const result = await loadDecks();
                safeOwner(); controller.signal.throwIfAborted();
                // Saving uses the same durable Flashcard outbox as manually created sets.
                clearTimeout(timeout); savingGeneration = true;
                cancel.disabled = true; dialog.querySelector('header button').disabled = true;
                const next = await saveDeck(generated); safeOwner();
                console.log('[FlashcardGen] 字卡集儲存成功，ID:', next.id);
                decks = result.decks; decks[next.id] = next; deck = next; study = {}; trash = false; search = ''; termFilter = 'all'; termQuery = '';
                draft = { ...clone(next), baseRevision: next.revision }; phase = 'editor';
                message = `已生成 ${next.cards.length} 張字卡並儲存至 Flashcard。`; dialog.close(); activate(); render();
            } catch (e) {
                console.error('[FlashcardGen] 生成字卡發生錯誤：', e);
                if (generationOwner === owner && dialog.open && form.isConnected) status.textContent = controller.signal.aborted ? '生成已取消或逾時，請重試。' : e.message || '生成失敗，請重試。';
            } finally {
                clearTimeout(timeout); savingGeneration = false; if (generation === controller) generation = null;
                submit.disabled = instructions.disabled = cancel.disabled = false; form.setAttribute('aria-busy', 'false');
                if (form.isConnected) dialog.querySelector('header button').disabled = false;
            }
        };
        instructions.focus();
    }
    function editingDialog() {
        const original = clone(draft); editingBatches(original);
        const body = modal('AI 編輯字卡', 'vocab-generation-dialog');
        node('p', `${original.cards.filter(c => c.term.trim() || c.definition.trim()).length} 張現有字卡`, body, 'vocab-muted');
        const form = node('form', null, body, 'vocab-generation-form');
        const instructions = field('編輯指令', form, '', 'textarea'); instructions.rows = 6; instructions.maxLength = MAX_GENERATION_INSTRUCTIONS; instructions.required = true;
        instructions.placeholder = '例如：修正英文拼字，將解釋改成繁體中文條列，重點用粗體。';
        const status = node('p', '', form, 'vocab-generation-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const controls = node('div', null, form, 'vocab-toolbar vocab-dialog-actions');
        const cancel = node('button', '取消', controls, 'vocab-button'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
        const submit = node('button', '套用 AI 編輯', controls, 'vocab-button vocab-primary'); submit.type = 'submit';
        form.onsubmit = async event => {
            event.preventDefault(); if (generation || busy) return;
            if (!instructions.value.trim()) { status.textContent = '請輸入編輯指令。'; instructions.focus(); return; }
            const controller = new AbortController(), editingOwner = owner, draftId = deck?.id;
            generation = controller; submit.disabled = instructions.disabled = true; form.setAttribute('aria-busy', 'true');
            try {
                safeOwner(); clearTimeout(draftTimer);
                const edited = await editDeckWithAI(original, instructions.value, controller.signal, (batch, total) => { status.textContent = total > 1 ? `正在編輯字卡… ${batch}/${total}` : '正在編輯字卡…'; });
                safeOwner(); controller.signal.throwIfAborted();
                savingGeneration = true; cancel.disabled = true; dialog.querySelector('header button').disabled = true;
                await saveDraft(draftId, edited); safeOwner(); controller.signal.throwIfAborted();
                draft = edited; phase = 'editor'; message = 'AI 編輯已套用，請檢查內容後按「完成」儲存。'; dialog.close(); render();
            } catch (e) {
                if (editingOwner === owner && dialog.open && form.isConnected) status.textContent = controller.signal.aborted || e.name === 'AbortError' ? '編輯已取消或逾時，原內容未修改。' : e.message || '編輯失敗，請重試。';
            } finally {
                savingGeneration = false;
                if (generation === controller) generation = null;
                submit.disabled = instructions.disabled = cancel.disabled = false; form.setAttribute('aria-busy', 'false');
                if (form.isConnected) dialog.querySelector('header button').disabled = false;
            }
        };
        instructions.focus();
    }
    function importDialog() {
        const body = modal('匯入文字', 'vocab-import-dialog');
        const header = dialog.querySelector('header'); header.querySelector('h2').textContent = '匯入資料';
        const instructions = node('p', '從 Word、Excel 或 Google 文件複製並貼上。', null, 'vocab-import-instructions'); header.insertBefore(instructions, header.lastElementChild);
        const input = field('貼上文字', body, '', 'textarea'); input.parentElement.classList.add('vocab-import-input'); input.rows = 8; input.spellcheck = false;
        input.placeholder = 'Word 1\tDefinition 1\nWord 2\tDefinition 2\nWord 3\tDefinition 3';
        const controls = node('div', null, body, 'vocab-import-controls');
        function separators(label, name, values, initial, customLabel) {
            const group = node('fieldset', null, controls, 'vocab-import-separators'); node('legend', label, group);
            const radios = {};
            function option(value, label, parent = group) {
                const row = node('label', null, parent, 'vocab-import-radio'); const radio = node('input', null, row); radio.type = 'radio'; radio.name = name; radio.value = value; radio.checked = value === initial;
                node('span', label, row); radio.onchange = update; radios[value] = radio; return row;
            }
            for (const [value, label] of values) option(value, label);
            if (customLabel) {
                const customRow = node('div', null, group, 'vocab-import-custom'); option('custom', '自訂', customRow).classList.add('vocab-custom-radio');
                const custom = field(customLabel, customRow); custom.placeholder = '自訂'; custom.maxLength = 20;
                const chooseCustom = () => { radios.custom.checked = true; update(); };
                custom.onfocus = chooseCustom; custom.oninput = chooseCustom;
                return { group, value: () => Object.values(radios).find(radio => radio.checked).value, set: v => { if (radios[v]) { radios[v].checked = true; update(); } }, custom };
            }
            return { group, value: () => Object.values(radios).find(radio => radio.checked).value, set: v => { if (radios[v]) { radios[v].checked = true; update(); } } };
        }
        const format = separators('匯入格式', 'vocab-import-format', [['delimiter', '分隔符號'], ['json', 'JSON']], 'delimiter');
        format.group.classList.add('vocab-import-format-group');
        const copyBtn = node('button', '複製 Prompt', format.group, 'vocab-button vocab-import-prompt-btn'); copyBtn.type = 'button';
        async function copyPrompt() {
            try {
                if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(FLASHCARD_IMPORT_PROMPT);
                else throw new Error('No clipboard');
            } catch {
                const ta = document.createElement('textarea'); ta.value = FLASHCARD_IMPORT_PROMPT; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
            }
            copyBtn.textContent = '已複製 Prompt'; format.set('json'); setTimeout(() => { copyBtn.textContent = '複製 Prompt'; }, 2000);
        }
        copyBtn.onclick = copyPrompt;
        const term = separators('單字與解釋之間', 'vocab-import-term', [['tab', 'Tab'], ['comma', 'Comma']], 'tab', '自訂單字分隔符');
        const row = separators('字卡與字卡之間', 'vocab-import-row', [['newline', '換行'], ['semicolon', '分號 ;']], 'newline', '自訂字卡分隔符');
        const jsonHint = node('p', '支援換行（\\n），可將 AI 生成的 JSON 直接貼上。', controls, 'vocab-import-json-hint'); jsonHint.hidden = true;
        const previewHeading = node('div', null, body, 'vocab-preview-heading'); node('h3', '預覽', previewHeading); const count = node('span', '0 張字卡', previewHeading, 'vocab-muted');
        const status = node('p', '', body, 'vocab-import-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.id = 'vocab-import-status'; input.setAttribute('aria-describedby', status.id);
        const empty = node('p', '尚無預覽內容', body, 'vocab-import-empty');
        const preview = node('div', null, body, 'vocab-import-preview'); let parsed = null;
        const footer = node('footer', null, dialog, 'vocab-import-footer'); button('取消匯入', footer, () => dialog.close());
        const confirm = button('匯入', footer, () => {
            if (!parsed?.cards.length || parsed.errors.length) return;
            const keep = draft.cards.filter(c => c.term.trim() || c.definition.trim());
            if (keep.length + parsed.cards.length > MAX_CARDS) { status.textContent = `加上現有字卡後超過 ${MAX_CARDS} 張。`; confirm.disabled = true; return; }
            draft.cards = [...keep, ...parsed.cards.map(c => ({ ...c, id: id() }))]; queueDraft(); dialog.close(); message = `已匯入 ${parsed.cards.length} 張字卡。`; render();
            host.querySelector(`[data-index="${keep.length}"] textarea`)?.focus();
        }, 'vocab-primary');
        function update() {
            const isJson = format.value() === 'json';
            term.group.hidden = isJson; row.group.hidden = isJson; jsonHint.hidden = !isJson;
            input.placeholder = isJson
                ? '[\n  {\n    "term": "單字",\n    "definition": "n. 蘋果\\n甜甜白白的"\n  }\n]'
                : 'Word 1\tDefinition 1\nWord 2\tDefinition 2\nWord 3\tDefinition 3';
            const options = isJson
                ? { format: 'json' }
                : { format: 'delimiter', term: term.value(), row: row.value(), termCustom: term.custom.value, rowCustom: row.custom.value };
            preview.replaceChildren();
            try {
                parsed = parseImport(input.value, options);
                const overLimit = draft.cards.filter(c => c.term.trim() || c.definition.trim()).length + parsed.cards.length > MAX_CARDS;
                confirm.disabled = !parsed.cards.length || parsed.errors.length > 0 || overLimit;
                count.textContent = `${parsed.cards.length} 張字卡`;
                status.textContent = overLimit ? `加上現有字卡後超過 ${MAX_CARDS} 張。` : parsed.errors.length ? `${parsed.errors.length} 處格式問題：第 ${parsed.errors[0].row} 行${parsed.errors[0].message}` : parsed.duplicates ? `${parsed.duplicates} 張重複（會保留）` : '';
                input.setAttribute('aria-invalid', String(parsed.errors.length > 0)); empty.hidden = parsed.cards.length > 0;
                for (const [i, c] of parsed.cards.entries()) { const r = node('div', null, preview); node('span', i + 1, r); node('span', c.term || '（空白）', r); node('span', c.definition || '（空白）', r); if (!c.term || !c.definition) r.classList.add('has-error'); }
            } catch (e) { status.textContent = e.message; confirm.disabled = true; parsed = null; count.textContent = '0 張字卡'; empty.hidden = true; input.setAttribute('aria-invalid', 'true'); }
        }
        input.oninput = update; update(); input.focus({ preventScroll: true });
    }
    function exportText() {
        const body = modal('匯出文字');
        const input = field('匯出內容', body, '', 'textarea'); input.rows = 8; input.readOnly = true;
        const controls = node('div', null, body, 'vocab-import-controls');
        const term = select('單字與解釋之間', controls, [['tab', 'Tab'], ['comma', '逗號 ,'], ['dash', '連字號 -'], ['custom', '自訂']], 'tab');
        const termCustom = field('自訂單字分隔符', controls); termCustom.maxLength = 20; termCustom.hidden = true; termCustom.parentElement.hidden = true;
        const row = select('字卡與字卡之間', controls, [['newline', '換行'], ['semicolon', '分號 ;'], ['custom', '自訂']], 'newline');
        const rowCustom = field('自訂字卡分隔符', controls); rowCustom.maxLength = 20; rowCustom.parentElement.hidden = true;
        const status = node('p', '', body, 'vocab-import-status'); status.setAttribute('role', 'status');
        button('下載文字檔', body, () => download(input.value, deck.title + '.txt', 'text/plain'), 'vocab-primary');
        function update() {
            termCustom.parentElement.hidden = term.value !== 'custom'; termCustom.hidden = false; rowCustom.parentElement.hidden = row.value !== 'custom';
            const a = term.value === 'tab' ? '\t' : term.value === 'comma' ? ',' : term.value === 'dash' ? '-' : termCustom.value;
            const b = row.value === 'newline' ? '\n' : row.value === 'semicolon' ? ';' : rowCustom.value;
            input.value = deck.cards.map(c => c.term + a + c.definition).join(b);
            status.textContent = '內容包含分隔符號時，請改用自訂分隔符。';
        }
        for (const e of [input, termCustom, rowCustom]) e.oninput = update; term.onchange = update; row.onchange = update; update();
    }
    function download(content, name, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = node('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    function learnOptions() {
        const source = phase === 'learn' ? session.options : preferred;
        return gradingOptions({ ...DEFAULT_OPTIONS, ...source, types: source.learnTypes || source.types || DEFAULT_OPTIONS.types });
    }
    async function beginLearn(options, restart = false) {
        if (options.activity === 'spell' && !('speechSynthesis' in window)) throw new Error('此瀏覽器不支援朗讀，請使用 Write。');
        // Validate before resetting progress, so an empty scope or type selection cannot erase a session.
        createSession(deck, restart ? {} : study, options);
        if (restart) study = await saveStudy(deck.id, study, newEvent('reset', { generation: id() }));
        let next = createSession(deck, study, { ...options, freshStart: restart });
        const flowKeys = ['activity', 'direction', 'scope', 'shuffle', 'goal', 'types', 'familiarity', 'chunkSize', 'practice'];
        if (!restart && phase === 'learn' && flowKeys.every(key => JSON.stringify(next.options[key]) === JSON.stringify(session.options[key]))) {
            next = { ...clone(session), options: next.options };
        }
        await persist(null, next); preferred = clone(next.options); session = next; phase = 'learn'; dialog.close(); render();
    }
    function settings(full = phase === 'learn', initialOptions = null) {
        const options = initialOptions || learnOptions();
        if (!full) {
            const body = modal('Learn 設定', 'vocab-goal-dialog');
            const h = dialog.querySelector('header'); h.querySelector('h2').textContent = '選擇這次學習的目標';
            h.prepend(node('p', deck.title, null, 'vocab-goal-deck'));
            const group = node('fieldset', null, body, 'vocab-goals'); node('legend', '這次學習的目標', group);
            for (const [value, label, glyph] of [['quick', '快速熟悉', '◷'], ['master', '記熟全部', '◎']]) {
                const l = node('label', null, group, 'vocab-goal'); const input = node('input', null, l); input.type = 'radio'; input.name = 'vocab-goal'; input.value = value; input.checked = options.goal === value;
                node('span', label, l); node('span', glyph, l, 'vocab-goal-icon'); input.onchange = () => { options.goal = value; };
            }
            const error = node('p', '', body, 'vocab-settings-error'); error.setAttribute('role', 'alert');
            const footer = node('div', null, body, 'vocab-options-footer');
            button('學習設定', footer, () => settings(true, { ...options, activity: 'learn', practice: false }), 'vocab-link');
            button('開始 Learn', footer, async () => { try { await beginLearn({ ...options, activity: 'learn', practice: false }); } catch (e) { error.textContent = e.message; } }, 'vocab-primary');
            return;
        }
        const body = modal('Learn 設定', 'vocab-options-dialog');
        const top = node('div', null, body, 'vocab-option-pills');
        const shuffle = pill('打亂順序', 'shuffle', top, options.shuffle), starred = pill('只學星號單字', 'star', top, options.scope === 'starred'), sound = pill('答題音效', 'audio', top, options.sound);
        function section(title) { const d = node('details', null, body, 'vocab-setting-section'); node('summary', title, d); return node('div', null, d, 'vocab-setting-content'); }
        const questionTypes = section('題型'); questionTypes.parentElement.open = true; const types = {};
        for (const [type, label] of Object.entries(typeLabels)) { types[type] = check(label, questionTypes, options.types.includes(type)); types[type].parentElement.classList.add('vocab-toggle'); }
        const answerWith = section('作答方向');
        const dir = select('作答方向', answerWith, [['term', '看解釋 → 答單字'], ['definition', '看單字 → 答解釋'], ['both', '正反向']], options.direction);
        const scope = select('練習範圍', answerWith, [['all', '全部'], ['starred', '已標星號'], ['learning', '尚未精熟'], ['due', '到期複習']], options.scope);
        starred.onchange = () => { scope.value = starred.checked ? 'starred' : 'all'; }; scope.onchange = () => { starred.checked = scope.value === 'starred'; };
        const goal = select('這次學習的目標', answerWith, [['master', '記熟全部'], ['quick', '快速熟悉']], options.goal);
        const familiarity = select('對這組單字的熟悉程度', answerWith, [['new', '剛開始學'], ['familiar', '已經看過']], options.familiarity);
        const chunk = select('每組單字數', answerWith, [['7', '7 張'], ['5', '5 張'], ['10', '10 張'], ['15', '15 張']], String(options.chunkSize));
        const gradingBody = section('批改方式');
        const grading = select('批改方式', gradingBody, GRADING_LEVELS, gradingLevel(options.grading));
        const semanticNotice = node('p', '智慧判讀在此裝置執行；首次使用會下載詞彙資料，需要語意模型時另下載約 380 MB。', gradingBody, 'vocab-muted');
        const updateNotice = () => { semanticNotice.hidden = grading.value === 'exact'; }; grading.onchange = updateNotice; updateNotice();
        const retype = check('答錯後重打正解', gradingBody, options.retype); retype.parentElement.classList.add('vocab-toggle');
        const audioBody = section('語音');
        const audio = check('朗讀題目', audioBody, options.audio), audioAnswer = check('朗讀答案', audioBody, options.audioAnswer);
        for (const input of [audio, audioAnswer]) input.parentElement.classList.add('vocab-toggle');
        const audioRate = select('朗讀速度', audioBody, [['0.9', '一般'], ['0.65', '慢速']], String(options.audioRate || 0.9));
        const modes = node('div', null, body, 'vocab-setting-content vocab-write-modes');
        const error = node('p', '', body, 'vocab-settings-error'); error.setAttribute('role', 'alert');
        function selected(activity = options.activity || 'learn') {
            const learnTypes = Object.keys(types).filter(k => types[k].checked);
            return { ...options, activity, goal: goal.value, familiarity: familiarity.value, direction: dir.value, scope: scope.value, types: learnTypes, learnTypes, grading: grading.value, retype: retype.checked, shuffle: shuffle.checked, audio: audio.checked, audioAnswer: audioAnswer.checked, audioRate: Number(audioRate.value), sound: sound.checked, chunkSize: Number(chunk.value) };
        }
        async function begin(activity, restart = false) { try { await beginLearn(selected(activity), restart); } catch (e) { error.textContent = e.message; error.scrollIntoView({ block: 'nearest' }); } }
        button('Write', modes, () => begin('write'), 'vocab-link'); button('Spell', modes, () => begin('spell'), 'vocab-link');
        button('重設 Learn 進度', modes, () => { const confirm = node('div', null, body, 'vocab-reset-confirm'); node('p', '重新學習這組字卡，歷史作答紀錄仍會保留。', confirm); button('確認重設並開始', confirm, () => begin('learn', true), 'vocab-primary'); confirm.scrollIntoView({ block: 'nearest' }); }, 'vocab-danger');
        const footer = node('div', null, dialog, 'vocab-options-footer');
        button('取消', footer, () => dialog.close());
        button(phase === 'learn' ? '儲存' : '開始 Learn', footer, () => begin(phase === 'learn' ? options.activity : 'learn'), 'vocab-primary');
    }
    function quickSettings() {
        stop();
        const existing = host.querySelector('.vocab-quick-options');
        if (existing) return;
        const popover = node('div', null, host, 'vocab-quick-options'); popover.id = 'vocab-quick-options'; popover.setAttribute('popover', 'auto'); popover.setAttribute('aria-label', 'Learn 快速設定');
        const options = learnOptions(), top = node('div', null, popover, 'vocab-option-pills');
        async function update(changes) { await beginLearn({ ...options, ...changes }); }
        pill('打亂順序', 'shuffle', top, options.shuffle, value => update({ shuffle: value }));
        pill('只學星號單字', 'star', top, options.scope === 'starred', value => update({ scope: value ? 'starred' : 'all' }));
        pill('答題音效', 'audio', top, options.sound, async value => { options.sound = value; session.options.sound = value; await persist(null, session); preferred = clone(session.options); });
        const group = node('div', null, popover, 'vocab-setting-content'); node('h3', '題型', group);
        for (const type of Object.keys(typeLabels)) {
            const input = toggle(typeLabels[type], group, options.types.includes(type), async value => {
                try { await update({ types: value ? [...options.types, type] : options.types.filter(t => t !== type), learnTypes: value ? [...options.types, type] : options.types.filter(t => t !== type) }); }
                catch (e) { popover.querySelector('.vocab-settings-error').textContent = e.message; input.checked = options.types.includes(type); }
            });
        }
        const grading = select('批改方式', group, GRADING_LEVELS, gradingLevel(options.grading));
        grading.onchange = () => void action(async () => {
            try { await update({ grading: grading.value }); }
            catch (e) { popover.querySelector('.vocab-settings-error').textContent = e.message; }
        });
        const error = node('p', '', popover, 'vocab-settings-error'); error.setAttribute('role', 'alert');
        button('全部設定', popover, () => { popover.remove(); settings(true); }, 'vocab-link');
    }
    async function persist(event, snapshot) {
        safeOwner();
        const deckId = deck.id;
        if (snapshot) snapshot.updatedAt = Math.max(Date.now(), snapshot.updatedAt || 0, (study.sessions?.[snapshot.mode]?.updatedAt || 0) + 1);
        study = await saveStudy(deckId, study, event, snapshot); safeOwner();
    }
    function studyHeader(mode, settingsAction) {
        const h = node('header', null, host, 'vocab-study-header');
        const menu = node('details', null, h, 'vocab-mode-menu'); const summary = node('summary', null, menu);
        const glyph = node('span', null, summary, 'vocab-mode-glyph'); glyph.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${studyIcons[phase === 'flash' ? 'cards' : 'learn']}</svg>`;
        node('span', mode, summary);
        const chevron = node('span', null, summary, 'vocab-mode-chevron');
        chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${studyIcons.chevron}</svg>`;
        const choices = node('div', null, menu, 'vocab-mode-list');
        button('Flashcards', choices, () => { menu.open = false; return startFlash(); }); button('Learn', choices, () => { menu.open = false; settings(false); });
        const center = node('div', null, h, 'vocab-study-center');
        if (phase === 'flash' && flash.options.track && !flash.completed) {
            const learning = node('div', null, center, 'vocab-mobile-count error');
            node('span', '還在學習', learning); node('strong', String(Object.values(flash.ratings).filter(value => !value).length), learning);
        }
        const title = node('div', null, center, 'vocab-study-title');
        const accessibleTitle = node('h1', mode, title, 'vocab-sr-only'); accessibleTitle.tabIndex = -1;
        if (phase === 'flash') node('strong', `${Math.min(flash.index + 1, flash.order.length)} / ${flash.order.length}`, title, 'vocab-study-count');
        node('span', deck.title, title);
        if (phase === 'flash' && flash.options.track && !flash.completed) {
            const known = node('div', null, center, 'vocab-mobile-count success');
            node('span', '知道了', known); node('strong', String(Object.values(flash.ratings).filter(Boolean).length), known);
        }
        const actions = node('div', null, h, 'vocab-study-actions');
        const settingsButton = studyIcon('settings', '設定', actions, settingsAction);
        if (phase === 'learn') settingsButton.setAttribute('popovertarget', 'vocab-quick-options');
        const close = studyIcon('close', '‹ ' + deck.title, actions, () => { stop(); phase = 'detail'; render(); }); close.title = '返回字卡集';
        return h;
    }
    function learnProgress() {
        const p = sessionProgress(session), goal = session.options.goal === 'quick' ? 1 : 2;
        const earned = p.displayedEarned, target = p.total * goal;
        const row = node('div', null, host, 'vocab-progress-row'); node('strong', earned, row, 'vocab-progress-count');
        const progress = node('div', null, row, 'vocab-learn-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', activityName(session) + ' 學習進度'); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(target)); progress.setAttribute('aria-valuenow', String(earned));
        const wholePass = session.options.activity !== 'learn';
        const segments = wholePass ? 2 : Math.min(24, Math.ceil(target / session.options.chunkSize));
        const segmentSize = wholePass ? p.total : segments === 24 ? target / segments : session.options.chunkSize;
        for (let i = 0; i < segments; i++) {
            const segment = node('span', null, progress), fill = node('i', null, segment);
            const width = `${Math.max(0, Math.min(1, (earned - i * segmentSize) / Math.min(segmentSize, target - i * segmentSize))) * 100}%`;
            fill.style.width = progressWidths[i] || width;
            requestAnimationFrame(() => { fill.style.width = width; });
        }
        node('strong', target, row, 'vocab-progress-count');
        const roundComplete = session.active.filter(k => roundDone(session, k)).length;
        node('p', `第 ${session.round} 輪 · ${wholePass ? '本輪' : '本組'} ${roundComplete}／${session.active.length} · ${p.mastered}／${p.total} ${wholePass ? '已答對兩次' : '已精熟'}`, host, 'vocab-round-state');
    }
    async function answer(response, skipped = false) {
        if (session.options.sound) { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); void audioContext.resume(); } catch {} }
        const answeredAt = Date.now();
        if (!session.current || session.feedback) return;
        const activeSession = session, activeDeck = deck, activeOperation = operation;
        const q = session.current, card = deck.cards.find(c => c.id === q.cardId);
        let judgement = null;
        if (!skipped && q.type === 'written' && String(response).trim()) {
            const submit = host.querySelector('.vocab-question-actions .vocab-primary');
            const status = node('p', '', host.querySelector('.vocab-written-form'), 'vocab-muted'); status.setAttribute('role', 'status');
            const form = host.querySelector('.vocab-written-form');
            form?.querySelectorAll('input,select,button').forEach(e => { e.disabled = true; });
            let cancelled = false;
            const controller = new AbortController();
            const cancel = node('button', '取消判讀', form, 'vocab-button vocab-link'); cancel.type = 'button';
            cancel.onclick = () => { cancelled = true; cancel.disabled = true; controller.abort(); resetEquivalence(); };
            if (submit) { submit.textContent = '判讀中…'; submit.disabled = true; }
            judgement = await gradeEquivalence({ prompt: promptFor(card, q.direction), expected: answerFor(card, q.direction), response: String(response), aliases: answersFor(card, q.direction).slice(1), grading: gradingFor(session),
                signal: controller.signal,
                onProgress: progress => {
                    status.textContent = progress.status === 'terminology' ? '載入詞彙資料中…' : progress.status === 'inference' ? '智慧判讀中…' : progress.status === 'progress' && Number.isFinite(progress.progress) ? `下載模型中… ${Math.floor(progress.progress)}%` : '載入智慧判讀模型中…';
                }
            });
            if (cancelled) judgement = { status: 'uncertain', correct: false, reason: 'cancelled' };
        }
        // A late worker response must not write into another account or deck.
        safeOwner();
        if (operation !== activeOperation || session !== activeSession || deck !== activeDeck || phase !== 'learn') return;
        let next = submitAnswer(session, deck, response, answeredAt, judgement); if (next === session) return;
        if (mobileStudy() && host.contains(document.activeElement)) document.activeElement.blur();
        if (skipped) next.feedback.skipped = true;
        const event = newEvent('answer', { cardId: card.id, revision: card.revision, direction: q.direction, correct: next.feedback.correct, response: next.feedback.response.slice(0, 4000), type: q.type,
            ordinal: next.ordinal, initialStage: Math.min(1, next.feedback.before.stage), sessionId: next.id, generation: next.generation, responseTimeMs: Math.max(0, answeredAt - questionAt) });
        next.feedback.eventId = event.id; await persist(event, next); session = next; render();
        if (session.options.sound) soundFeedback(next.feedback.correct);
        if (next.feedback.correct && !next.feedback.requiresAcknowledgement) timer = setTimeout(() => { if (phase === 'learn' && !host.hidden && !dialog.open) void action(() => nextLearn()); }, session.options.audioAnswer ? 1600 : 950);
    }
    async function nextLearn() { const next = advanceSession(session, deck); if (next === session) return; await persist(null, next); session = next; render(); }
    function renderLearn(feedbackChanged = false) {
        studyHeader(session.options.practice ? '持續練習' : activityName(session), () => quickSettings());
        if (session.options.practice) node('p', `已作答 ${session.ordinal} 題`, host, 'vocab-round-state'); else learnProgress();
        if (session.completed || session.checkpoint) { renderCheckpoint(); return; }
        const q = session.current, card = deck.cards.find(c => c.id === q.cardId), feedback = session.feedback;
        const currentQuestionKey = `${session.id}:${q.key}:${session.ordinal}`;
        const entering = !feedback && questionKey !== currentQuestionKey;
        if (entering) { questionAt = Date.now(); questionKey = currentQuestionKey; }
        const panel = node('section', null, host, `vocab-question ${entering ? 'is-entering' : ''} ${feedback ? feedback.correct ? 'is-correct' : 'is-wrong' : ''}`);
        panel.dataset.type = q.type;
        const top = node('div', null, panel, 'vocab-question-top'); node('span', q.direction === 'term' ? '解釋' : '單字', top, 'vocab-muted');
        if (!feedback && session.facts[q.key].wrong && !session.facts[q.key].streak) node('span', '再次練習', top, 'vocab-retry-label');
        icon('◖))', q.type === 'spell' ? '朗讀答案' : '朗讀題目', top, () => speak(q.type === 'spell' ? answerFor(card, q.direction) : promptFor(card, q.direction), q.type === 'spell' ? q.direction : q.direction === 'term' ? 'definition' : 'term'));
        starButton(card, top);
        text(promptFor(card, q.direction), panel, 'vocab-prompt');
        const area = node('div', null, panel, 'vocab-answer-area');
        const result = feedback ? node('div', null, area, `vocab-answer-result ${feedbackChanged ? 'is-entering' : ''}`) : area;
        const hint = node('p', q.type === 'multi' ? '選擇所有正確答案' : q.type === 'choice' ? '選擇答案' : typeLabels[q.type], result, 'vocab-question-hint');
        if (!feedback && q.type === 'written') hint.classList.add('vocab-sr-only');
        if (feedback) { hint.textContent = feedback.correct ? '✓ 答對了' : feedback.skipped ? '已略過' : feedback.gradingStatus === 'uncertain' ? '無法確定，請核對正確答案' : '答錯了'; hint.className += feedback.correct ? ' success' : feedback.skipped ? ' vocab-muted' : ' error'; hint.setAttribute('role', 'status'); }
        const actions = !feedback ? node('div', null, null, 'vocab-question-actions') : null;
        if (actions) button('不知道', actions, () => answer(q.type === 'multi' ? [] : q.type === 'truefalse' ? !q.truth : q.type === 'flash' ? false : '', true), 'vocab-dontknow');
        if (q.type === 'choice') {
            const choices = node('div', null, result, 'vocab-choices');
            if (q.choices.some(value => value.length > 65)) choices.classList.add('long-choices');
            q.choices.forEach((value, i) => {
                const correctOption = gradeAnswer(value, [q.choiceAnswer]), selected = feedback?.response === value;
                const b = button('', choices, () => feedback ? correctOption && nextLearn() : answer(value), 'vocab-choice');
                const key = node('span', null, b, 'vocab-choice-key');
                if (feedback && correctOption) {
                    key.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';
                } else if (feedback && selected) {
                    key.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
                } else {
                    key.textContent = i + 1;
                }
                text(value, b);
                if (feedback) { b.classList.toggle('correct-option', correctOption); b.classList.toggle('selected-correct', feedback.correct && selected); b.classList.toggle('wrong-option', !feedback.correct && selected); b.disabled = !correctOption; }
            });
        } else if (q.type === 'multi') {
            const choices = node('div', null, result, 'vocab-choices'); const selected = new Set();
            q.choices.forEach((value, i) => { const correct = q.correctAnswers.includes(value); const l = node('label', null, choices, `vocab-choice ${feedback && correct ? 'correct-option' : ''}`); const c = node('input', null, l); c.type = 'checkbox'; c.disabled = !!feedback; c.setAttribute('aria-label', value); node('span', i + 1, l, 'vocab-choice-key'); text(value, l); c.onchange = () => c.checked ? selected.add(value) : selected.delete(value); if (feedback) c.checked = JSON.parse(feedback.response || '[]').includes(value); });
            if (!feedback) { const confirm = button('確認答案', actions, () => answer([...selected]), 'vocab-primary'); confirm.disabled = true; choices.addEventListener('change', () => { confirm.disabled = selected.size === 0; }); }
        } else if (q.type === 'written' || q.type === 'spell') {
            if (!feedback) {
                const targetText = answerFor(card, q.direction) || '';
                const multiline = /\r?\n/.test(targetText) || answersFor(card, q.direction).some(a => /\r?\n/.test(a));
                const form = node('form', null, area, 'vocab-answer-form vocab-written-form'); form.id = 'vocab-written-answer'; const input = field('你的答案', form, '', multiline ? 'textarea' : 'input'); input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 4000; input.placeholder = '輸入答案';
                if (multiline) {
                    input.rows = Math.min(6, Math.max(2, (targetText.match(/\n/g) || []).length + 1));
                    input.enterKeyHint = 'enter';
                    input.onkeydown = e => {
                        if (e.key === 'Enter') {
                            if (e.ctrlKey || e.metaKey || (!e.shiftKey && !/\r?\n/.test(targetText))) {
                                e.preventDefault();
                                form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
                            }
                        }
                    };
                } else {
                    input.enterKeyHint = 'done';
                }
                input.value = q.draftResponse || '';
                const b = node('button', '確認答案', actions, 'vocab-button vocab-primary'); b.type = 'submit'; b.setAttribute('form', form.id);
                b.disabled = !input.value.trim(); input.oninput = () => { q.draftResponse = input.value; b.disabled = !input.value.trim(); };
                const cacheKey = `${deck.id}:${deck.revision}:${q.direction}`;
                if (symbolsKey !== cacheKey) { symbolsKey = cacheKey; symbols = writingSymbols(deck, q.direction); }
                if (symbols.length) {
                    const palette = node('div', null, form, 'vocab-symbols'); let upper = false; palette.setAttribute('aria-label', '特殊字元');
                    const draw = () => {
                        palette.replaceChildren();
                        for (const char of symbols) { const value = upper ? char.toLocaleUpperCase() : char; button(value, palette, () => { input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus({ preventScroll: true }); }, 'vocab-symbol'); }
                        if (symbols.some(char => char !== char.toLocaleUpperCase())) button(upper ? '小寫' : '大寫', palette, () => { upper = !upper; draw(); input.focus({ preventScroll: true }); }, 'vocab-link');
                    }; draw();
                }
                form.onsubmit = e => { e.preventDefault(); if (!input.value.trim()) return; void action(() => answer(input.value)); };
                const partial = q.type === 'spell' ? '' : writingHint(answerFor(card, q.direction));
                if (partial) {
                    const output = node('div', q.hintShown ? partial : '', form, 'vocab-written-hint'); output.hidden = !q.hintShown; output.setAttribute('role', 'status');
                    const reveal = button('顯示提示', null, async () => { q.hintShown = true; await persist(null, session); if (output) output.hidden = false; if (output) output.textContent = partial; reveal.hidden = true; if (!mobileStudy()) input.focus({ preventScroll: true }); }, 'vocab-hint-btn'); reveal.hidden = !!q.hintShown;
                    actions?.prepend(reveal);
                }
                if (!host.hidden && !mobileStudy()) input.focus({ preventScroll: true });
            } else if (!feedback.skipped) {
                node('p', '你的答案', result, 'vocab-answer-label vocab-muted');
                const response = node('div', null, result, `vocab-response ${feedback.correct ? 'is-correct' : 'is-wrong'}`);
                const glyph = node('span', null, response, 'vocab-response-glyph'); glyph.setAttribute('aria-hidden', 'true'); glyph.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${studyIcons[feedback.correct ? 'check' : 'close']}</svg>`;
                if (q.type === 'spell' && !feedback.correct) spellText(spellingFeedback(feedback.response, feedback.expected).response, response, 'vocab-incorrect-answer');
                else text(feedback.response, response, feedback.correct ? 'vocab-correct-answer' : 'vocab-incorrect-answer');
            }
        } else if (q.type === 'truefalse') {
            text(q.statement, result, 'vocab-statement');
            if (!feedback) { const choices = node('div', null, area, 'vocab-choices'); button('是', choices, () => answer(true), 'vocab-choice'); button('否', choices, () => answer(false), 'vocab-choice'); }
        } else if (q.type === 'flash') {
            const reveal = button('查看答案', area, () => { reveal.hidden = true; text(answerFor(card, q.direction), area, 'vocab-revealed-answer'); if (session.options.audioAnswer) speak(answerFor(card, q.direction), q.direction); const ratings = node('div', null, area, 'vocab-ratings'); button('還在學習', ratings, () => answer(false)); button('知道了', ratings, () => answer(true), 'vocab-primary'); });
            if (feedback) reveal.hidden = true;
        }
        if (actions) area.append(actions);
        if (feedback) {
            if ((!feedback.correct || feedback.requiresAcknowledgement) && q.type !== 'choice' && q.type !== 'multi') {
                node('p', feedback.correct ? '原始答案' : '正確答案', result, 'vocab-answer-label vocab-muted');
                const expected = node('div', null, result, 'vocab-expected-answer');
                if (q.type === 'spell' && !feedback.correct) { spellText(spellingFeedback(feedback.response, feedback.expected).expected, expected, 'vocab-correct-answer'); button('逐字拼讀', expected, () => speakSpelling(feedback.expected, q.direction)); }
                else text(feedback.expected, expected, 'vocab-correct-answer');
            }
            if (feedback.gradingReason === 'model-unavailable') node('p', '智慧判讀模型無法載入，請核對正確答案或切換為絕對相同。', result, 'vocab-muted');
            const footer = node('div', null, result, 'vocab-feedback');
            if (feedback.correct && feedback.requiresAcknowledgement && ['written', 'spell'].includes(q.type)) {
                button('我是錯的', footer, async () => { const next = overrideCorrect(session, Date.now(), false); await persist(newEvent('override', { originalId: feedback.eventId, correct: false }), next); session = next; render(); }, 'vocab-link');
            }
            if (!feedback.correct && ['written', 'spell'].includes(q.type)) {
                if (!feedback.skipped) button('我的答案其實正確', footer, async () => { const next = overrideCorrect(session); await persist(newEvent('override', { originalId: feedback.eventId, correct: true }), next); session = next; render(); }, 'vocab-link');
                if (!feedback.retyped) {
                    const targetText = answerFor(card, q.direction) || '';
                    const multiline = /\r?\n/.test(targetText) || answersFor(card, q.direction).some(a => /\r?\n/.test(a));
                    const form = node('form', null, footer, 'vocab-answer-form'); const correction = field('重打正確答案', form, '', multiline ? 'textarea' : 'input'); correction.autocomplete = 'off'; correction.spellcheck = false; correction.maxLength = 4000;
                    if (multiline) {
                        correction.rows = Math.min(6, Math.max(2, (targetText.match(/\n/g) || []).length + 1));
                        correction.enterKeyHint = 'enter';
                        correction.onkeydown = e => {
                            if (e.key === 'Enter') {
                                if (e.ctrlKey || e.metaKey || (!e.shiftKey && !/\r?\n/.test(targetText))) {
                                    e.preventDefault();
                                    form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
                                }
                            }
                        };
                    } else {
                        correction.enterKeyHint = 'done';
                    }
                    const check = node('button', '確認訂正', form, 'vocab-button vocab-primary'); check.type = 'submit';
                    const status = node('p', '', form); status.setAttribute('role', 'status');
                    form.onsubmit = e => { e.preventDefault(); void action(async () => { if (!gradeAnswer(correction.value, q.type === 'spell' ? [answerFor(card, q.direction)] : answersFor(card, q.direction))) { status.textContent = '請輸入畫面上的正確答案。'; return; } const next = clone(session); next.feedback.retyped = true; next.updatedAt = Date.now(); await persist(newEvent('repair', { cardId: card.id, direction: q.direction, originalId: feedback.eventId }), next); session = next; await nextLearn(); }); };
                    if (!mobileStudy()) correction.focus({ preventScroll: true });
                }
            }
            if (feedback.retyped) { node('p', feedback.correct ? '按 Enter 繼續' : q.type === 'choice' ? '點正確答案或按 Enter 繼續' : '按 Enter 繼續', footer, 'vocab-feedback-help vocab-muted'); button(session.options.activity === 'spell' && !feedback.correct ? '重試' : '繼續', footer, () => nextLearn(), 'vocab-primary'); }
            if (feedbackChanged) requestAnimationFrame(() => {
                if (!result.isConnected || host.hidden || dialog.open) return;
                result.scrollIntoView({ block: result.offsetHeight > host.clientHeight - 32 ? 'start' : 'nearest' });
            });
        }
        if (!feedback && (session.options.audio || q.type === 'spell')) speechTimer = setTimeout(() => { if (!host.hidden && !dialog.open) speak(q.type === 'spell' ? answerFor(card, q.direction) : promptFor(card, q.direction), q.type === 'spell' ? q.direction : q.direction === 'term' ? 'definition' : 'term'); }, 120);
        if (feedback && !feedback.correct && session.options.activity === 'spell') speechTimer = setTimeout(() => { if (!host.hidden && !dialog.open) speakSpelling(feedback.expected, q.direction); }, 120);
        else if (feedback && session.options.audioAnswer) speechTimer = setTimeout(() => { if (!host.hidden && !dialog.open) speak(answerFor(card, q.direction), q.direction); }, 120);
    }
    function spellText(parts, parent, cls) { const e = node('div', null, parent, cls + ' vocab-spelling'); for (const part of parts) node(part.incorrect ? 'mark' : 'span', part.text, e); return e; }
    function renderCheckpoint() {
        const panel = node('section', null, host, 'vocab-checkpoint');
        const p = sessionProgress(session); const ring = node('div', `${p.percent}%`, panel, 'vocab-completion-ring'); ring.style.setProperty('--progress', `${p.percent * 3.6}deg`);
        node('h2', session.completed ? '本次學習完成' : '本輪完成', panel); stats(panel, p, session.options.activity !== 'learn');
        const answers = session.roundAnswers, right = answers.filter(a => a.correct).length;
        const period = session.options.activity === 'spell' ? '本次' : '本輪';
        node('p', `${period}答對 ${right} 題 · 答錯 ${answers.length - right} 題`, panel, 'vocab-muted');
        const missed = [...new Set(answers.filter(a => !a.correct).map(a => a.cardId))];
        if (missed.length) { node('h3', period + '曾答錯的單字', panel); const list = node('div', null, panel, 'vocab-missed'); for (const cardId of missed) { const card = deck.cards.find(c => c.id === cardId); const row = node('div', null, list); text(card.term, row); text(card.definition, row); } }
        const studied = [...new Set(answers.map(a => a.cardId))];
        if (studied.length) {
            const details = node('details', null, panel, 'vocab-round-terms'); node('summary', `${period}練習的 ${studied.length} 張字卡`, details); details.open = !missed.length;
            const list = node('div', null, details, 'vocab-missed');
            for (const cardId of studied) {
                const card = deck.cards.find(c => c.id === cardId), row = node('div', null, list); text(card.term, row); text(card.definition, row);
                const actions = node('div', null, row, 'vocab-round-actions'); starButton(card, actions);
                icon('◖))', '朗讀單字', actions, () => speak(card.term, 'term'));
            }
        }
        if (!session.completed) { button('繼續下一輪', panel, nextRound, 'vocab-primary'); node('p', '按任意字元鍵繼續', panel, 'vocab-muted'); }
        else {
            button('繼續練習', panel, async () => { const next = createSession(deck, study, { ...session.options, practice: true, scope: session.options.scope === 'starred' ? 'starred' : 'all' }); await persist(null, next); session = next; render(); }, 'vocab-primary');
            button('返回字卡集', panel, () => { phase = 'detail'; render(); });
            button('重新開始 ' + activityName(session), panel, async () => { if (session.options.activity === 'learn') study = await saveStudy(deck.id, study, newEvent('reset', { generation: id() })); const next = createSession(deck, study, { ...session.options, practice: false, familiarity: 'new', freshStart: true }); await persist(null, next); session = next; render(); });
        }
    }
    async function nextRound() { const next = continueRound(session, deck); await persist(null, next); session = next; render(); }
    async function speak(value, side) {
        const synthesis = window.speechSynthesis;
        if (!synthesis) { reportSpeechError('此瀏覽器不支援朗讀。'); return; }
        stopSpeech(); const generation = speechGeneration;
        const language = side === 'term' ? deck.termLanguage : deck.definitionLanguage;
        const rate = phase === 'learn' ? session.options.audioRate || 0.9 : 0.9;
        let voices = synthesis.getVoices?.() || [];
        if (!voices.length && synthesis.getVoices && synthesis.addEventListener) voices = await new Promise(resolve => {
            let timeout, finished = false;
            const finish = () => {
                if (finished) return; finished = true; clearTimeout(timeout); synthesis.removeEventListener('voiceschanged', loaded);
                if (pendingVoiceLoad === finish) pendingVoiceLoad = null;
                resolve(synthesis.getVoices());
            };
            const loaded = () => { if (synthesis.getVoices().length) finish(); };
            pendingVoiceLoad = finish; synthesis.addEventListener('voiceschanged', loaded); timeout = setTimeout(finish, 1000); loaded();
        });
        if (generation !== speechGeneration || host.hidden) return;
        const code = language.toLowerCase().replaceAll('_', '-'), base = code.split('-')[0];
        const voiceCode = voice => voice.lang.toLowerCase().replaceAll('_', '-');
        const voice = voices.find(v => voiceCode(v) === code) || voices.find(v => voiceCode(v).split('-')[0] === base);
        if (base === 'ms' && !voice && synthesis.getVoices) { reportSpeechError('此裝置尚無馬來文語音，請在系統語音設定新增馬來文後重試。'); return; }
        if (speechError && message === speechError) report(''); speechError = '';
        const utterance = new SpeechSynthesisUtterance(value); utterance.lang = language; utterance.rate = rate; if (voice) utterance.voice = voice;
        utterance.onerror = event => {
            if (generation !== speechGeneration || ['canceled', 'interrupted'].includes(event.error)) return;
            reportSpeechError(base === 'ms' ? '馬來文語音無法播放，請檢查系統語音設定後重試。' : '語音無法播放，請檢查系統語音設定後重試。');
        };
        synthesis.speak(utterance);
    }
    function speakSpelling(value, side) { speak(Array.from(value).join(' . '), side); }
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
    async function changeFlashOptions(changes) {
        const options = { ...flash.options, ...changes };
        if (options.direction !== flash.options.direction || options.scope !== flash.options.scope || options.shuffle !== flash.options.shuffle) await startFlash(options, true);
        else { flash.options = options; flash.playing = false; await saveFlash(); render(); }
    }
    function flashSettings() {
        const body = modal('Flashcards 設定', 'vocab-flash-options');
        toggle('追蹤進度', body, flash.options.track, value => changeFlashOptions({ track: value }));
        toggle('只學星號單字', body, flash.options.scope === 'starred', value => changeFlashOptions({ scope: value ? 'starred' : 'all' }));
        const termLangName = languages.find(l => l[0] === deck.termLanguage)?.[1] || deck.termLanguage;
        const defLangName = languages.find(l => l[0] === deck.definitionLanguage)?.[1] || deck.definitionLanguage;
        const isDiff = termLangName && defLangName && termLangName !== defLangName;
        const termLabel = isDiff ? termLangName : '單字';
        const defLabel = isDiff ? defLangName : '解釋';
        dropdown('正面顯示', body, [['term', defLabel], ['definition', termLabel]], flash.options.direction, val => action(() => changeFlashOptions({ direction: val })));
        toggle('同時顯示雙面', body, !!flash.options.showBoth, value => changeFlashOptions({ showBoth: value }));
        toggle('打亂順序', body, flash.options.shuffle, value => changeFlashOptions({ shuffle: value }));
        const shortcuts = node('details', null, body, 'vocab-shortcuts'); node('summary', '鍵盤快捷鍵', shortcuts);
        const keys = node('dl', null, shortcuts);
        for (const [label, key] of [['知道了／下一張', '→'], ['還在學習／上一張', '←'], ['翻面', 'Space'], ['撤銷分類／上一張', 'Backspace'], ['標記星號', 'S'], ['編輯', 'E'], ['打亂', 'H'], ['朗讀', 'A'], ['單字正面', 'T'], ['解釋正面', 'D']]) { node('dt', label, keys); node('dd', key, keys); }
        toggle('朗讀卡片', body, flash.options.audio, value => changeFlashOptions({ audio: value }));
        button('重新開始 Flashcards', body, async () => { await startFlash(flash.options, true); dialog.close(); }, 'vocab-danger');
    }
    async function editFlashCard() {
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        const body = modal('編輯字卡'); const term = field('單字', body, card.term, 'textarea'), definition = field('解釋', body, card.definition, 'textarea');
        term.maxLength = definition.maxLength = 4000;
        const error = node('p', '', body, 'vocab-settings-error'); error.setAttribute('role', 'alert');
        const footer = node('div', null, body, 'vocab-options-footer'); button('取消', footer, () => dialog.close());
        button('儲存字卡', footer, async () => {
            if (!term.value.trim() || !definition.value.trim()) { error.textContent = '請填寫單字與解釋。'; return; }
            const next = clone(deck), edited = next.cards.find(c => c.id === card.id); edited.term = term.value; edited.definition = definition.value;
            deck = await saveDeck(next, deck); decks[deck.id] = deck; flash.deckRevision = deck.revision; await saveFlash(); dialog.close(); render();
        }, 'vocab-primary');
    }
    async function saveFlash() { flash.updatedAt = Date.now(); await persist(null, flash); }
    async function flip() {
        if (flash.options.showBoth) return;
        flash.flipped = !flash.flipped;
        updateFlip();
        await saveFlash();
    }
    function updateFlip() {
        const stage = host.querySelector('.vocab-flip'); if (!stage) return;
        stage.classList.toggle('flipped', flash.flipped); stage.classList.toggle('show-both', !!flash.options.showBoth);
        stage.setAttribute('aria-label', flash.options.showBoth ? '字卡雙面' : flash.flipped ? '查看正面' : '查看背面');
        const front = stage.querySelector('.front'), back = stage.querySelector('.back');
        const frontHidden = !flash.options.showBoth && flash.flipped;
        const backHidden = !flash.options.showBoth && !flash.flipped;
        front?.setAttribute('aria-hidden', String(frontHidden));
        back?.setAttribute('aria-hidden', String(backHidden));
        front?.querySelectorAll('button').forEach(b => { b.tabIndex = frontHidden ? -1 : 0; });
        back?.querySelectorAll('button').forEach(b => { b.tabIndex = (backHidden || flash.options.showBoth) ? -1 : 0; });
        const frontActions = front?.querySelector('.vocab-card-actions'), backActions = back?.querySelector('.vocab-card-actions');
        if (flash.options.showBoth) {
            if (backActions) backActions.style.display = 'none';
            backActions?.setAttribute('aria-hidden', 'true');
        } else {
            if (backActions) backActions.style.display = '';
            if (frontActions) frontActions.style.display = '';
        }
        stage.querySelectorAll('.vocab-face-scroll').forEach(scroller => {
            const { scrollTop, scrollHeight, clientHeight } = scroller;
            const max = scrollHeight - clientHeight;
            const face = scroller.closest('.vocab-face');
            if (max <= 1) {
                scroller.dataset.overflow = 'none';
                if (face) face.dataset.overflow = 'none';
            } else {
                const top = scrollTop > 2, bottom = scrollTop < max - 2;
                const state = top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none';
                scroller.dataset.overflow = state;
                if (face) face.dataset.overflow = state;
            }
        });
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        if (flash.options.audio) speak(flash.flipped ? answerFor(card, flash.options.direction) : promptFor(card, flash.options.direction), flash.flipped ? flash.options.direction : flash.options.direction === 'term' ? 'definition' : 'term');
    }
    function speakFlash() {
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        speak(flash.flipped ? answerFor(card, flash.options.direction) : promptFor(card, flash.options.direction), flash.flipped ? flash.options.direction : flash.options.direction === 'term' ? 'definition' : 'term');
    }
    async function rateFlash(known) {
        if (flash.completed) return;
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        const stage = host.querySelector('.vocab-flip'), mobile = isMobileFlash();
        if (!mobile) stage?.classList.add(known ? 'swipe-known' : 'swipe-learning');
        updateFlashPreview(1);
        const animation = mobile ? animateMobileFlashExit(stage, known ? 1 : -1, true) : null;
        const event = newEvent('flash', { cardId: card.id, direction: flash.options.direction, revision: card.revision, correct: known, sessionId: flash.id });
        const next = clone(flash); next.history ||= []; next.history.push({ index: flash.index, eventId: event.id, cardId: card.id, known });
        next.ratings[card.id] = known; next.index++; next.flipped = false; next.completed = next.index >= next.order.length; next.updatedAt = Date.now(); next.playing = false;
        try {
            if (mobile) await Promise.all([persist(event, next), animation]);
            else { await persist(event, next); await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 210)); }
        } catch (error) { resetMobileFlashSwipe(stage); stage?.classList.remove('swipe-known', 'swipe-learning'); throw error; }
        flash = next; render();
    }
    async function undoFlash() {
        const last = flash.history?.at(-1); if (!last) return;
        const next = clone(flash); next.history.pop(); next.index = last.index; next.completed = false; next.flipped = false; next.playing = false;
        const previous = next.history.filter(item => item.cardId === last.cardId).at(-1);
        if (previous) next.ratings[last.cardId] = previous.known; else delete next.ratings[last.cardId];
        const original = study.events[last.eventId];
        // A compensating flash event preserves the immutable history and works with existing Firebase rules.
        await persist(newEvent('flash', { cardId: original.cardId, direction: original.direction, revision: original.revision, correct: original.correct, sessionId: flash.id, originalId: original.id, value: false }), next);
        flash = next; render();
    }
    async function moveFlash(shift, swipeDirection = -Math.sign(shift)) {
        const stage = host.querySelector('.vocab-flip'), dest = flash.index + shift;
        if (dest < 0) { resetMobileFlashSwipe(stage); return; }
        const next = clone(flash); next.index = Math.min(flash.order.length, dest); next.completed = dest >= flash.order.length; next.flipped = false; next.updatedAt = Date.now();
        updateFlashPreview(shift);
        try { await Promise.all([persist(null, next), animateMobileFlashExit(stage, swipeDirection, false)]); }
        catch (error) { resetMobileFlashSwipe(stage); throw error; }
        flash = next; render();
    }
    async function shuffleFlash() {
        await startFlash({ ...flash.options, shuffle: true }, true);
    }
    function updateFlashPreview(shift) {
        const preview = host.querySelector('.vocab-flash-preview'); if (!preview) return;
        preview.replaceChildren();
        const card = deck.cards.find(c => c.id === flash.order[flash.index + shift]);
        preview.hidden = !card; if (!card) return;
        preview.classList.toggle('show-both', !!flash.options.showBoth);
        text(promptFor(card, flash.options.direction), preview, 'vocab-preview-face');
        if (flash.options.showBoth) text(answerFor(card, flash.options.direction), preview, 'vocab-preview-face');
    }
    function renderFlash() {
        studyHeader('Flashcards', () => flashSettings());
        const known = Object.values(flash.ratings).filter(Boolean).length, learning = Object.values(flash.ratings).filter(v => !v).length;
        if (flash.completed) {
            const panel = node('section', null, host, 'vocab-checkpoint'); node('h2', '本輪字卡完成', panel); node('p', flash.options.track ? `知道了 ${known} 張 · 還在學習 ${learning} 張` : `已瀏覽 ${flash.order.length} 張字卡`, panel);
            if (learning) button(`再練還在學習的 ${learning} 張`, panel, async () => { const next = clone(flash); next.order = next.order.filter(cardId => next.ratings[cardId] === false); next.ratings = {}; next.history = []; next.index = 0; next.flipped = false; next.completed = false; next.updatedAt = Date.now(); await persist(null, next); flash = next; render(); }, 'vocab-primary');
            if (flash.history?.length) button('撤銷上一張分類', panel, undoFlash);
            button('在 Learn 中練習', panel, () => settings(false)); button('重新開始 Flashcards', panel, () => startFlash(flash.options, true)); button('返回字卡集', panel, () => { phase = 'detail'; render(); }); return;
        }
        const workspace = node('section', null, host, 'vocab-flash-workspace');
        if (flash.options.track) {
            const counts = node('div', null, workspace, 'vocab-flash-counts');
            node('span', `還在學習 ${learning}`, counts, 'error'); node('span', `知道了 ${known}`, counts, 'success');
        }
        const card = deck.cards.find(c => c.id === flash.order[flash.index]);
        const wrapper = node('div', null, workspace, 'vocab-flash-card');
        const preview = node('div', null, wrapper, 'vocab-flash-preview'); preview.setAttribute('aria-hidden', 'true'); preview.inert = true;
        updateFlashPreview(1);
        const stage = node('div', null, wrapper, 'vocab-flip');
        stage.setAttribute('role', 'button'); stage.setAttribute('tabindex', '0');
        stage.setAttribute('aria-label', flash.options.showBoth ? '字卡雙面' : flash.flipped ? '查看正面' : '查看背面');
        stage.onkeydown = e => { if (e.target !== stage) return; if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void action(flip); } };
        const faces = node('div', null, stage, 'vocab-flip-inner');
        for (const side of ['front', 'back']) {
            const face = node('div', null, faces, 'vocab-face ' + side);
            const actions = node('div', null, face, 'vocab-card-actions');
            actions.onclick = e => e.stopPropagation(); actions.onpointerdown = e => e.stopPropagation(); actions.onpointerup = e => e.stopPropagation();
            studyIcon('edit', '編輯字卡', actions, editFlashCard);
            studyIcon('audio', '朗讀卡片', actions, () => {
                const textToSpeak = side === 'front' ? promptFor(card, flash.options.direction) : answerFor(card, flash.options.direction);
                const lang = side === 'front' ? (flash.options.direction === 'term' ? 'definition' : 'term') : flash.options.direction;
                speak(textToSpeak, lang);
            });
            starButton(card, actions);
            const scroller = node('div', null, face, 'vocab-face-scroll');
            text(side === 'front' ? promptFor(card, flash.options.direction) : answerFor(card, flash.options.direction), scroller, 'vocab-face-text');
            const updateFade = () => {
                const { scrollTop, scrollHeight, clientHeight } = scroller;
                const max = scrollHeight - clientHeight;
                if (max <= 1) {
                    scroller.dataset.overflow = 'none';
                    face.dataset.overflow = 'none';
                    return;
                }
                const top = scrollTop > 2, bottom = scrollTop < max - 2;
                const state = top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none';
                scroller.dataset.overflow = state;
                face.dataset.overflow = state;
            };
            scroller.addEventListener('scroll', updateFade, { passive: true });
            requestAnimationFrame(updateFade);
            if (typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(updateFade);
                ro.observe(scroller);
            }
            Object.defineProperty(face, 'scrollTop', {
                get() { return scroller.scrollTop; },
                set(v) { scroller.scrollTop = v; updateFade(); },
                configurable: true
            });
            Object.defineProperty(face, 'scrollHeight', {
                get() { return scroller.scrollHeight; },
                configurable: true
            });
            Object.defineProperty(face, 'clientHeight', {
                get() { return scroller.clientHeight; },
                configurable: true
            });
            face.scrollTo = (...args) => scroller.scrollTo(...args);
        }
        const feedback = node('div', null, stage, 'vocab-swipe-feedback'); feedback.setAttribute('aria-hidden', 'true');
        node('span', '還在學習', feedback, 'vocab-swipe-learning'); node('span', '知道了', feedback, 'vocab-swipe-known');
        bindMobileFlashSwipe(stage, {
            blocked: () => busy || dialog.open || host.hidden || phase !== 'flash', tracking: () => flash.options.track,
            preview: direction => updateFlashPreview(flash.options.track || direction < 0 ? 1 : -1),
            swipe: direction => { void action(() => flash.options.track ? rateFlash(direction > 0) : moveFlash(direction < 0 ? 1 : -1, direction)); }
        });
        updateFlip(); let down = null, swiped = false;
        stage.addEventListener('scroll', () => { swiped = true; }, { capture: true, passive: true });
        stage.onpointerdown = e => { if (isMobileFlash() || e.target.closest('.vocab-card-actions')) return; down = [e.clientX, e.clientY]; swiped = false; };
        stage.onpointercancel = () => { down = null; };
        stage.onpointerup = e => { if (!down) return; const delta = e.clientX - down[0]; if (Math.abs(delta) > 70 && Math.abs(e.clientY - down[1]) < 100) { swiped = true; void action(() => flash.options.track ? rateFlash(delta > 0) : moveFlash(delta < 0 ? 1 : -1)); } else if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { swiped = true; } down = null; };
        stage.onclick = e => { if (e.target.closest('.vocab-card-actions')) return; if (!swiped) void action(flip); swiped = false; };
        const controls = node('div', null, workspace, 'vocab-flash-controls');
        toggle('追蹤進度', controls, flash.options.track, value => changeFlashOptions({ track: value }));
        const navigation = node('div', null, controls, 'vocab-flash-navigation');
        if (flash.options.track) { studyIcon('close', '← 還在學習', navigation, () => rateFlash(false), 'vocab-learning'); studyIcon('check', '知道了 →', navigation, () => rateFlash(true), 'vocab-known'); }
        else { const prev = studyIcon('left', '上一張字卡', navigation, () => moveFlash(-1)); prev.disabled = flash.index === 0; studyIcon('right', '下一張字卡', navigation, () => moveFlash(1)); }
        const extras = node('div', null, controls, 'vocab-flash-extras');
        if (flash.options.track) { const undo = studyIcon('undo', '撤銷上一張分類', extras, undoFlash); undo.disabled = !flash.history?.length; }
        else { const play = studyIcon(flash.playing ? 'pause' : 'play', flash.playing ? '暫停' : '自動播放', extras, async () => { flash.playing = !flash.playing; await saveFlash(); render(); }); play.setAttribute('aria-pressed', String(flash.playing)); }
        studyIcon('shuffle', '打亂', extras, shuffleFlash);
        if (flash.playing) timer = setTimeout(() => { if (host.hidden || dialog.open || phase !== 'flash') return; void action(async () => { if (!flash.flipped && !flash.options.showBoth) { await flip(); timer = setTimeout(() => { if (!host.hidden && !dialog.open) void action(() => moveFlash(1)); }, 2200); } else await moveFlash(1); }); }, 2200);
    }
    window.addEventListener('flashcard-sync', ({ detail }) => {
        if (detail.uid !== owner) return;
        if (detail.error) { report(detail.error); if (detail.conflict) { conflict = true; host.dataset.conflictDeck = detail.deckId; render(); } }
    });
    window.addEventListener('sync-status', async ({ detail }) => {
        if (!owner || host.hidden || auth.currentUser?.uid !== owner) return;
        if (!detail.error && detail.pending === 0 && !conflict) {
            if (message && (message.includes('同步') || message.includes('存取'))) report('');
        }
    });
    new MutationObserver(() => { if (host.hidden) { stop(); generation?.abort(); if (dialog.classList.contains('vocab-generation-dialog')) dialog.close(); } studyLayout(); }).observe(host, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    document.addEventListener('keydown', e => {
        if (host.hidden || !owner || dialog.open || document.querySelector('dialog[open]') || host.querySelector('[popover]:popover-open') || host.querySelector('.vocab-mode-menu[open]') || busy || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        if (e.target.matches('input, textarea, select, [contenteditable]')) return;
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button, a, summary')) return;
        const needsConfirmation = session?.feedback?.correct && session.feedback.requiresAcknowledgement;
        if (e.key === 'Escape') { e.preventDefault(); stop(); phase = 'detail'; render(); return; }
        if (phase === 'flash' && !flash.completed) {
            if (e.key === ' ') { e.preventDefault(); void action(flip); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); void action(() => flash.options.track ? rateFlash(e.key === 'ArrowRight') : moveFlash(e.key === 'ArrowRight' ? 1 : -1)); }
            if (e.key === 'Backspace') { e.preventDefault(); void action(() => flash.options.track ? undoFlash() : moveFlash(-1)); }
            const shortcuts = { s: () => star(deck.cards.find(c => c.id === flash.order[flash.index])), e: editFlashCard, h: shuffleFlash, a: speakFlash, t: () => changeFlashOptions({ direction: 'definition' }), d: () => changeFlashOptions({ direction: 'term' }) };
            const shortcut = shortcuts[e.key.toLowerCase()]; if (shortcut) { e.preventDefault(); void action(shortcut); }
        } else if (phase === 'learn' && session.feedback?.retyped && (e.key === 'Enter' || !needsConfirmation && (e.key === ' ' || !session.feedback.correct && e.key.length === 1))) { e.preventDefault(); void action(nextLearn); }
        else if (phase === 'learn' && session.checkpoint && !session.completed && (e.key === 'Enter' || e.key === ' ' || e.key.length === 1)) { e.preventDefault(); void action(nextRound); }
        else if (phase === 'learn' && !session.feedback && session.current?.type === 'choice' && /^[1-4]$/.test(e.key)) { const value = session.current.choices[Number(e.key) - 1]; if (value) { e.preventDefault(); void action(() => answer(value)); } }
    });
    dialog.addEventListener('cancel', e => { if (savingGeneration) e.preventDefault(); });
    dialog.addEventListener('close', () => {
        generation?.abort(); generation = null;
        if (host.hidden) return;
        if (phase === 'flash' && flash?.playing) { flash.playing = false; render(); }
        if (phase === 'flash') host.querySelector('.vocab-flip')?.focus({ preventScroll: true });
        if (phase === 'learn') (mobileStudy() ? host.querySelector('h1') : host.querySelector('.vocab-answer-form input') || host.querySelector('h1'))?.focus({ preventScroll: true });
    });
    return {
        async open() {
            const ticket = ++operation; owner = auth.currentUser?.uid || null; activate();
            if (!owner) { phase = 'list'; render(); return; }
            if (phase !== 'list' && deck && decks[deck.id]) { render(); return; }
            phase = 'list'; message = '載入字卡集…'; render();
            try { const result = await loadDecks(); safeOwner(); if (ticket !== operation) return; decks = result.decks; message = result.error || (result.pending ? `${result.pending} 筆等待同步` : ''); render(); } catch (e) { report(e.message); }
        },
        async generate(items) {
            console.log('[FlashcardGen] vocabulary.generate 執行', {
                itemCount: items?.length,
                currentUser: auth.currentUser?.uid || null,
                currentOwner: owner
            });
            if (!auth.currentUser) throw new Error('請先登入。');
            const uid = auth.currentUser.uid, sources = clone(sourceQuestions(items));
            if (uid !== owner) {
                console.log('[FlashcardGen] 切換使用者 owner', { uid, oldOwner: owner });
                this.resetForUser(uid);
            }
            safeOwner(); generationDialog(sources);
        },
        resetForUser(uid) { if (uid === owner) return; operation++; resetEquivalence(); generation?.abort(); generation = null; stop(); clearTimeout(draftTimer); dialog.close(); owner = uid || null; decks = {}; deck = null; study = {}; session = null; flash = null; draft = null; phase = 'list'; message = ''; conflict = false; preferred = { ...DEFAULT_OPTIONS, defaultLanguage: navigator.language || 'zh-TW' }; direction = 'term'; search = ''; termFilter = 'all'; termQuery = ''; screen = ''; questionKey = ''; symbolsKey = ''; symbols = []; if (!host.hidden) void this.open(); }
    };
}
