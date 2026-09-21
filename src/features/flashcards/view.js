import { auth } from '../../services/firebase.js';
import { learningState, loadLearning, savePreference } from '../../services/learning.js';
import { markdown } from '../../shared/content.js';
import { validateCard, matchesAnswer, reviewCard } from './model.js';
import { sourceQuestions, generateCards } from './service.js';
const el = (tag, cls, text, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; parent?.append(n); return n; };
export function createFlashcards({ renderMath }) {
    const root = el('dialog', 'flashcards-dialog', null, document.body); root.id = 'flashcardsView'; root.setAttribute('aria-label', '字卡');
    const header = el('header', 'fc-header', null, root), heading = el('h2', '', '我的字卡', header);
    const nav = el('div', 'fc-actions', null, header);
    const body = el('main', 'fc-main', null, root);
    const status = el('p', 'fc-status', '', root); status.setAttribute('role', 'status');
    let owner, opener, generation, screen = 'library', deck, session, busy = false, token = 0;
    const button = (text, parent, action, primary = false) => {
        const b = el('button', primary ? 'primary-button' : 'quiet-button', text, parent); b.type = 'button';
        b.onclick = async () => {
            if (busy) return; busy = true; b.disabled = true;
            try { checkOwner(); await action(); } catch (e) { status.textContent = e.name === 'AbortError' ? '製作已取消或逾時，請重試。' : e.message || '儲存失敗，請重試。'; }
            finally { busy = false; b.disabled = false; }
        }; return b;
    };
    const checkOwner = () => { if (!owner || owner !== auth.currentUser?.uid) { close(); throw new Error('請以原帳戶重新開啟字卡。'); } };
    function close() { generation?.abort(); token++; root.close(); opener?.focus({ preventScroll: true }); }
    root.addEventListener('cancel', e => { e.preventDefault(); close(); });
    root.addEventListener('close', () => { generation?.abort(); token++; });
    function layout(title, view) {
        heading.textContent = title; screen = view; body.replaceChildren(); nav.replaceChildren(); status.textContent = ''; body.scrollTop = 0;
        if (view !== 'library') button('我的字卡', nav, () => { generation?.abort(); token++; library(); });
        // Closing remains available while network work is in flight.
        const dismiss = el('button', 'quiet-button', '關閉字卡', nav); dismiss.onclick = close;
    }
    async function show() {
        if (!auth.currentUser) throw new Error('請先登入後使用字卡。');
        owner = auth.currentUser.uid; opener = document.activeElement;
        if (!root.open) root.showModal();
        const opened = ++token;
        layout('我的字卡', 'loading'); status.textContent = '載入字卡中…';
        await loadLearning();
        if (!root.open || token !== opened) return false;
        checkOwner(); return true;
    }
    function decks() {
        return Object.entries(learningState).filter(([key, d]) => (key.startsWith('deck_') || key.startsWith('card_')) && !d.deleted)
            .map(([key, d]) => ({ key, ...d, title: d.title || '我的筆記字卡', cards: d.cards || [{ ...d, id: key }] }))
            .filter(d => d.cards.length).sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
    }
    async function persist(next) {
        checkOwner(); const { key, ...value } = next;
        await savePreference(key, value); checkOwner(); deck = next;
    }
    function rich(text, parent, cls = '') { const n = el('div', cls, null, parent); n.innerHTML = markdown(text); renderMath(n); return n; }
    function library() {
        layout('我的字卡', 'library');
        const top = el('div', 'fc-intro', null, body); el('p', '把不熟的觀念，變成下一次能想起來的答案。', top);
        button('新增字卡', top, () => { deck = { key: `deck_${crypto.randomUUID()}`, title: '自訂字卡', cards: [], createdAt: Date.now() }; edit(null); }, true);
        const items = decks();
        if (!items.length) { const empty = el('div', 'fc-empty', null, body); el('h3', '', '從一個不熟的觀念開始', empty); el('p', '', '到錯題本點選「AI 一鍵製作字卡」，或在這裡建立自己的字卡。', empty); }
        for (const d of items) {
            const tile = el('article', 'fc-deck', null, body), due = d.cards.filter(c => (c.dueAt || 0) <= Date.now()).length;
            el('span', 'fc-eyebrow', d.aiGenerated ? 'AI 觀念字卡' : '自訂字卡', tile); el('h3', '', d.title, tile);
            el('p', 'fc-muted', `${d.cards.length} 張字卡 · ${due} 張到期`, tile);
            const actions = el('div', 'fc-actions', null, tile);
            button('開啟字卡集', actions, () => { deck = structuredClone(d); detail(); }, true);
        }
    }
    function detail() {
        layout(deck.title, 'detail');
        el('p', 'fc-muted', `${deck.cards.length} 張字卡${deck.aiGenerated ? ' · AI 依錯題整理，請核對來源與教材；可自由編輯。' : ''}`, body);
        const actions = el('div', 'fc-actions fc-mode-actions', null, body);
        button('字卡 · 空白鍵翻面', actions, () => start('flip'), true);
        button('Learn · 打字填空', actions, () => start('typing'));
        button('只複習到期字卡', actions, () => start('flip', deck.cards.filter(c => (c.dueAt || 0) <= Date.now())));
        button('新增一張', actions, () => edit(null));
        for (const [i, card] of deck.cards.entries()) {
            const row = el('article', 'fc-card-row', null, body);
            el('span', 'fc-eyebrow', String(i + 1).padStart(2, '0'), row);
            const contents = el('div', '', null, row); rich(card.front, contents, 'fc-front-preview'); rich(card.back, contents, 'fc-muted');
            const controls = el('div', 'fc-actions', null, row);
            button('編輯', controls, () => edit(card.id));
            button('刪除', controls, async () => {
                if (!window.confirm('刪除此字卡？')) return;
                await persist({ ...deck, cards: deck.cards.filter(c => c.id !== card.id), deleted: deck.cards.length === 1 });
                deck.cards.length ? detail() : library();
            });
        }
        status.textContent = '已儲存在此裝置；連線時自動同步。';
    }
    function edit(id) {
        const card = deck.cards.find(c => c.id === id) || { id: crypto.randomUUID(), front: '', back: '', typingPrompt: '___', acceptedAnswers: [], explanation: '' };
        layout('編輯字卡', 'edit');
        const form = el('form', 'fc-editor', null, body), fields = {};
        for (const [key, label, value, max] of [
            ['title', '字卡集名稱', deck.title, 100], ['front', '正面 · 回想問題', card.front, 1500], ['back', '背面 · 正確答案', card.back, 2000],
            ['typingPrompt', '填空提示 · 用 ___ 表示空格', card.typingPrompt || `${card.front}\n___`, 1500],
            ['acceptedAnswers', '可接受答案 · 每行一個同義詞', (card.acceptedAnswers || (card.back.length <= 200 ? [card.back] : [])).join('\n'), 2400],
            ['explanation', '補充說明（選填）', card.explanation || '', 3000]
        ]) {
            const labelEl = el('label', '', label, form); const input = el(key === 'title' ? 'input' : 'textarea', '', null, labelEl);
            input.value = value; input.maxLength = max; input.required = key !== 'explanation'; if (key !== 'title') input.rows = key === 'acceptedAnswers' ? 3 : 2; fields[key] = input;
        }
        el('p', 'fc-muted', '打字比對會忽略大小寫、頭尾空白及全半形差異；醫學符號與數值須一致。修改答案時，也請更新填空與同義詞。', form);
        const controls = el('div', 'fc-actions fc-split-actions', null, form), save = el('button', 'primary-button', '儲存字卡', controls); save.type = 'submit';
        button('取消編輯', controls, () => deck.cards.length ? detail() : library());
        form.onsubmit = async event => {
            event.preventDefault(); if (busy) return; busy = true; save.disabled = true;
            try {
                checkOwner(); if (!fields.title.value.trim()) throw new Error('請填寫字卡集名稱。');
                const edited = validateCard({ ...card, front: fields.front.value.trim(), back: fields.back.value.trim(), typingPrompt: fields.typingPrompt.value.trim(),
                    acceptedAnswers: fields.acceptedAnswers.value.split('\n').map(s => s.trim()).filter(Boolean), explanation: fields.explanation.value.trim(), editedAt: Date.now() });
                const cards = id ? deck.cards.map(c => c.id === id ? edited : c) : [...deck.cards, edited];
                await persist({ ...deck, title: fields.title.value.trim(), cards, deleted: false }); detail();
            } catch (e) { status.textContent = e.message; } finally { busy = false; save.disabled = false; }
        };
    }
    function start(mode, cards = deck.cards) {
        if (!cards.length) { status.textContent = '目前沒有到期字卡，可以選擇複習整組。'; return; }
        if (mode === 'typing' && cards.some(c => !c.typingPrompt || !c.acceptedAnswers?.length)) { status.textContent = '這組包含舊版筆記字卡，請先編輯並補上填空提示與可接受答案。'; return; }
        session = { mode, cards: structuredClone(cards), index: 0, results: [], revealed: false, result: null };
        practice();
    }
    function practice() {
        if (session.index >= session.cards.length) { finish(); return; }
        const card = session.cards[session.index]; session.revealed = false; session.result = null;
        layout(deck.title, 'practice');
        const meta = el('div', 'fc-session-meta', null, body); el('span', '', session.mode === 'flip' ? '字卡模式' : 'Learn · 打字填空', meta); el('span', '', `${session.index + 1} / ${session.cards.length}`, meta);
        const progress = el('progress', 'fc-progress', null, body); progress.max = session.cards.length; progress.value = session.index; progress.setAttribute('aria-label', '字卡複習進度');
        const stage = el('section', 'fc-stage', null, body); stage.tabIndex = 0;
        if (session.mode === 'flip') {
            const label = el('span', 'fc-eyebrow', '回想問題', stage), face = rich(card.front, stage, 'fc-face');
            const flip = button('查看答案', stage, () => session.toggle?.()); flip.dataset.flip = 'true';
            const extra = el('div', 'fc-extra', null, body); extra.hidden = true;
            if (card.explanation) rich(card.explanation, extra);
            const ratings = el('div', 'fc-actions fc-ratings fc-split-actions', null, body); ratings.hidden = true;
            button('還不熟', ratings, () => advance(false)); button('記得了', ratings, () => advance(true), true);
            session.toggle = () => {
                session.revealed = !session.revealed; label.textContent = session.revealed ? '正確答案' : '回想問題';
                face.innerHTML = markdown(session.revealed ? card.back : card.front); renderMath(face);
                flip.textContent = session.revealed ? '回到問題' : '查看答案'; extra.hidden = ratings.hidden = !session.revealed;
                stage.classList.toggle('is-flipped', session.revealed);
            };
            el('p', 'fc-hint', '空白鍵翻面 · 看過答案後，選擇熟悉程度', body); stage.focus({ preventScroll: true });
        } else {
            el('span', 'fc-eyebrow', '填入缺少的觀念', stage); rich(card.typingPrompt, stage, 'fc-face');
            const form = el('form', 'fc-typing-form', null, stage), label = el('label', 'fc-input-label', '你的答案', form);
            const input = el('input', 'fillblank-input', null, label); input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 200; input.required = true;
            const submit = el('button', 'primary-button', '確認答案', form); submit.type = 'submit';
            const feedback = el('div', 'fc-feedback', null, body); feedback.setAttribute('role', 'status');
            form.onsubmit = event => {
                event.preventDefault(); if (event.isComposing || busy || session.result || !input.value.trim()) return;
                session.result = { correct: matchesAnswer(input.value, card.acceptedAnswers), input: input.value };
                input.disabled = true; submit.disabled = true;
                feedback.classList.add(session.result.correct ? 'is-correct' : 'is-wrong');
                el('h3', '', session.result.correct ? '答對了' : '再記一次', feedback);
                el('p', '', `你的答案：${input.value}`, feedback); rich(card.back, feedback); el('p', 'fc-muted', `可接受答案：${card.acceptedAnswers.join(' / ')}`, feedback);
                if (card.explanation) rich(card.explanation, feedback);
                const actions = el('div', 'fc-actions fc-split-actions', null, feedback);
                if (!session.result.correct) button('我的答案也正確', actions, () => { session.result.correct = true; feedback.classList.replace('is-wrong', 'is-correct'); feedback.querySelector('h3').textContent = '已自行標為正確'; });
                const next = button('下一張', actions, () => advance(session.result.correct), true); next.focus({ preventScroll: true });
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); });
            el('p', 'fc-hint', '輸入短答案，再按 Enter 確認。中文選字時不會送出。', body); input.focus({ preventScroll: true });
        }
        const sourceIds = card.sourceIds || [];
        if (sourceIds.length && deck.sources) {
            const details = el('details', 'fc-sources', null, body); el('summary', '', '查看來源錯題', details);
            for (const source of deck.sources.filter(s => sourceIds.includes(s.id))) { el('p', 'fc-muted', source.source, details); rich(source.question, details); }
        }
    }
    function toggle() { if (!busy && screen === 'practice' && session.mode === 'flip') session.toggle?.(); }
    async function advance(correct) {
        const current = session.cards[session.index];
        const cards = deck.cards.map(c => c.id === current.id ? reviewCard(c, correct) : c);
        await persist({ ...deck, cards });
        session.results.push({ id: current.id, correct }); session.index++; practice();
    }
    function finish() {
        layout('本輪複習完成', 'complete'); const panel = el('section', 'fc-complete', null, body);
        const correct = session.results.filter(r => r.correct).length;
        el('p', 'fc-eyebrow', session.mode === 'flip' ? '自我回想' : '打字練習', panel); el('h3', '', `${correct} / ${session.results.length}`, panel);
        el('p', 'fc-muted', session.mode === 'flip' ? '張標為記得了' : '張回答正確（含自行標記）', panel);
        const actions = el('div', 'fc-actions', null, panel); const wrong = session.results.filter(r => !r.correct).map(r => deck.cards.find(c => c.id === r.id));
        if (wrong.length) button(`再練不熟的 ${wrong.length} 張`, actions, () => start(session.mode, wrong), true);
        button('再練整組', actions, () => start(session.mode)); button('編輯與管理字卡', actions, detail);
        status.textContent = '本輪熟悉程度已保存；不影響錯題本的答題紀錄。';
    }
    root.addEventListener('keydown', e => {
        if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === 'Space' && screen === 'practice' && session.mode === 'flip'
            && !e.target.closest('input, textarea, select, [contenteditable=true]') && (!e.target.closest('button') || e.target.dataset.flip)) {
            e.preventDefault(); e.stopPropagation(); if (!e.repeat) toggle();
        }
    });
    async function generate(items) {
        const eligible = items.filter(m => m.status !== 'mastered');
        if (!eligible.length) throw new Error('請選擇待複習的錯題。');
        if (eligible.length > 30) throw new Error('每次最多製作 30 題的觀念字卡，請先勾選或篩選錯題。');
        if (!await show()) return;
        const sources = sourceQuestions(eligible), run = ++token;
        const attempt = async () => {
            const controller = new AbortController(); generation = controller; const timeout = setTimeout(() => controller.abort(), 90000);
            layout('AI 製作觀念字卡', 'generating');
            el('div', 'fc-generating', `正在整理 ${sources.length} 題錯題中的不熟觀念…`, body);
            el('p', 'fc-muted', 'AI 會製作回想問題、簡短答案與填空練習。關閉可取消。', body);
            try {
                const cards = await generateCards(sources, controller.signal); checkOwner();
                if (!root.open || token !== run || controller.signal.aborted) return;
                await persist({ key: `deck_${crypto.randomUUID()}`, title: `${eligible[0].subject || '錯題'} · 觀念字卡`, aiGenerated: true, createdAt: Date.now(), sources,
                    cards: cards.map(c => ({ ...c, id: crypto.randomUUID(), dueAt: Date.now(), intervalDays: 0 })) });
                if (root.open && token === run) detail();
            } catch (e) {
                if (!root.open || token !== run) return;
                layout('字卡尚未製作完成', 'generation-error');
                el('p', '', e.name === 'AbortError' ? 'AI 回應逾時，請重試。' : e.message, body);
                button('重新製作字卡', body, attempt, true);
            } finally { clearTimeout(timeout); if (generation === controller) generation = null; }
        };
        await attempt();
    }
    return { open: async () => { if (await show()) library(); }, generate, close };
}
