import { createSelectMenu } from '../../shared/select-menu.js';
import { flattenMistakes, filterMistakes, getArchivedBankKeys, isArchivedMistake } from './model.js';
import { markdown, sortOptionKeys } from '../../shared/content.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
const date = value => value ? new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric' }).format(value) : '日期未記錄';

export function createNotebook({ root, getCache, refresh, setStatus, practice, makeCards, renderMath, alert, isStarred, toggleStar, getCatalog }) {
    let filters = { query: '', subject: [], quiz: '', status: 'active', sort: 'recent' };
    let selected = new Set();
    let limit = 30;
    let visible = [];
    let opener;
    let previousScrollY = 0;
    let request = 0;
    const content = root.querySelector('#mistakeListContent');
    const search = root.querySelector('#mistakeSearch');
    const subjects = root.querySelector('#mistakeSubject');
    const quizzes = root.querySelector('#mistakeQuiz');
    const sort = root.querySelector('#mistakeSort');
    const menus = [subjects, quizzes, sort].map(createSelectMenu);
    const cardsBtn = root.querySelector('#mistakeFlashcardsBtn');
    const eligibleCards = () => (selected.size ? visible.filter(m => selected.has(m.id)) : visible).filter(m => m.status !== 'mastered');
    const practiceBtn = root.querySelector('#mistakePracticeBtn');
    const summary = root.querySelector('#mistakeSummary');
    const selection = root.querySelector('#mistakeSelection');
    const selectAll = root.querySelector('#mistakeSelectAll');
    const clear = root.querySelector('#mistakeClearSelection');

    function getActiveMistakes() {
        const catalog = typeof getCatalog === 'function' ? getCatalog() : getCatalog;
        const archived = getArchivedBankKeys(catalog);
        return flattenMistakes(getCache()).filter(m => !isArchivedMistake(m, archived));
    }

    function options(node, entries, label, value) {
        const isMultiple = node.multiple;
        const selectedValues = isMultiple
            ? new Set(Array.isArray(value) ? value : (value ? [value] : []))
            : null;
        const firstOption = new Option(label, '');
        if (isMultiple && selectedValues.size === 0) {
            firstOption.selected = true;
        }
        const optionElements = entries.map(([key, text]) => {
            const opt = new Option(text, key);
            if (isMultiple && selectedValues.has(key)) {
                opt.selected = true;
            }
            return opt;
        });
        node.replaceChildren(firstOption, ...optionElements);
        if (!isMultiple) {
            node.value = typeof value === 'string' ? value : '';
        }
    }
    function updateFilters(all = getActiveMistakes()) {
        options(subjects, [...new Set(all.map(m => m.subject))].sort().map(s => [s, s]), '全部科目', filters.subject);
        const subjectList = Array.isArray(filters.subject) ? filters.subject : (filters.subject ? [filters.subject] : []);
        const subjectSet = subjectList.length ? new Set(subjectList) : null;
        const scoped = all.filter(m => !subjectSet || subjectSet.has(m.subject));
        if (filters.quiz && !scoped.some(m => m.quizKey === filters.quiz)) filters.quiz = '';
        options(quizzes, [...new Map(scoped.map(m => [m.quizKey, m.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-Hant')), '全部題庫', filters.quiz);
        root.querySelectorAll('[data-mistake-status]').forEach(button => {
            const status = button.dataset.mistakeStatus;
            const count = all.filter(m => status === 'all' || (status === 'mastered' ? m.status === status : m.status !== 'mastered')).length;
            button.textContent = `${{ active: '待複習', mastered: '已熟悉', all: '全部' }[status]} ${count}`;
            button.setAttribute('aria-pressed', String(filters.status === status));
        });
    }
    function updateSelection() {
        const count = selected.size;
        selection.textContent = count ? `已選 ${count} 題` : `${visible.length} 題`;
        selectAll.checked = !!visible.length && visible.every(m => selected.has(m.id));
        selectAll.indeterminate = count > 0 && !selectAll.checked;
        selectAll.disabled = !visible.length;
        clear.hidden = !count;
        practiceBtn.textContent = count ? `練習所選 ${count} 題` : `開始複習${visible.length ? ` · ${visible.length} 題` : ''}`;
        practiceBtn.disabled = !visible.length;
        cardsBtn.disabled = !eligibleCards().length;
        cardsBtn.textContent = !selected.size && eligibleCards().length > 30 ? 'AI 一鍵製作字卡（前 30 題）' : 'AI 一鍵製作字卡';
        cardsBtn.title = '依所選待複習錯題製作；未勾選時按目前排序取前 30 題。每次最多 30 題。';
    }
    function renderCard(m) {
        const card = el('article', 'review-card');
        const meta = el('div', 'review-meta');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(m.id);
        checkbox.setAttribute('aria-label', `選取：${m.question.slice(0, 60)}`);
        checkbox.onchange = () => { checkbox.checked ? selected.add(m.id) : selected.delete(m.id); updateSelection(); };
        meta.append(checkbox, el('span', 'review-source', `${m.subject} / ${m.title}`), el('span', 'review-count', `答錯 ${m.count || 1} 次`));
        if (typeof isStarred === 'function' && typeof toggleStar === 'function') {
            const starBtn = el('button', 'review-star-btn star-btn');
            starBtn.type = 'button';
            starBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" aria-hidden="true"><path class="star-fill" d="m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149Z"/><path class="star-outline" d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z"/></svg>`;
            const applyState = active => {
                starBtn.classList.toggle('active', active);
                starBtn.setAttribute('aria-label', active ? '取消星號' : '標記星號');
                starBtn.title = active ? '取消星號' : '標記星號';
            };
            applyState(Boolean(isStarred(m)));
            starBtn.onclick = async e => {
                e.stopPropagation();
                starBtn.disabled = true;
                try {
                    const next = await toggleStar(m);
                    applyState(next);
                } catch {
                    alert('星號狀態未儲存，請重試。');
                } finally {
                    starBtn.disabled = false;
                }
            };
            meta.append(starBtn);
        }
        const question = el('div', 'review-question');
        question.innerHTML = markdown(m.question);
        card.append(meta, question);
        if (m.options) {
            const list = el('div', 'review-options');
            Object.entries(m.options).sort(([a], [b]) => sortOptionKeys(a, b)).forEach(([key, text]) => {
                const row = el('div', 'review-option');
                row.append(el('span', 'review-option-label', key));
                const value = el('div'); value.innerHTML = markdown(text); row.append(value); list.append(row);
            });
            card.append(list);
        }
        const details = el('details', 'review-answer');
        details.append(el('summary', '', '查看答案與詳解'));
        const body = el('div', 'review-answer-body');
        if (m.lastSelection != null) body.append(el('p', 'review-last-answer', `上次作答：${[].concat(m.lastSelection).join('、')}`));
        body.append(el('p', 'review-correct-answer', `正確答案：${[].concat(m.answer ?? '尚未提供').join('、')}`));
        const explanation = el('div', 'review-explanation');
        explanation.innerHTML = markdown(m.explanation || '尚無詳解');
        body.append(explanation);
        if (m.origin) body.append(el('p', 'review-origin', `出處：${m.origin}`));
        details.append(body);
        details.addEventListener('toggle', () => { if (details.open) renderMath(body); });
        card.append(details);
        const footer = el('div', 'review-footer');
        footer.append(el('span', '', `最近答錯 ${date(m.lastMistake)}${m.correctStreak ? ` · 連續答對 ${m.correctStreak} 次` : ''}`));
        const status = el('button', 'secondary-button', m.status === 'mastered' ? '移回待複習' : '標為已熟悉');
        status.onclick = async () => {
            status.disabled = true;
            try { await setStatus(m, m.status === 'mastered' ? 'active' : 'mastered'); render(); }
            catch { alert('狀態未儲存，請重試。'); status.disabled = false; }
        };
        footer.append(status); card.append(footer); renderMath(card);
        return card;
    }
    function render() {
        const all = getActiveMistakes();
        updateFilters(all);
        menus.forEach(menu => menu.refresh());
        visible = filterMistakes(all, filters);
        selected = new Set([...selected].filter(id => visible.some(m => m.id === id)));
        content.replaceChildren();
        const hasSubject = Array.isArray(filters.subject) ? filters.subject.length > 0 : Boolean(filters.subject);
        const hasFilter = Boolean(filters.query || filters.quiz || hasSubject);
        summary.textContent = hasFilter ? `符合條件 ${visible.length} 題` : '連續答對 2 次，自動移至已熟悉；再答錯會回到待複習。';
        if (!visible.length) {
            const empty = el('div', 'empty-state');
            empty.append(el('h3', '', filters.status === 'mastered' ? '尚無已熟悉的題目' : '目前沒有待複習的錯題'));
            empty.append(el('p', '', hasFilter ? '試試其他關鍵字，或清除篩選。' : '答錯的題目會保存在這裡。'));
            const reset = el('button', 'secondary-button', '清除篩選');
            reset.onclick = () => { filters = { query: '', subject: [], quiz: '', status: 'all', sort: 'recent' }; search.value = ''; sort.value = 'recent'; render(); };
            if (hasFilter) empty.append(reset);
            content.append(empty);
        } else {
            content.append(...visible.slice(0, limit).map(renderCard));
            if (visible.length > limit) {
                const more = el('button', 'load-more secondary-button', `顯示更多（尚有 ${visible.length - limit} 題）`);
                more.onclick = () => { limit += 30; render(); };
                content.append(more);
            }
        }
        updateSelection();
    }
    function changed() { selected.clear(); limit = 30; render(); }
    search.oninput = () => { filters.query = search.value; changed(); };
    subjects.onchange = () => { filters.subject = [...subjects.selectedOptions].map(o => o.value).filter(Boolean); filters.quiz = ''; changed(); };
    quizzes.onchange = () => { filters.quiz = quizzes.value; changed(); };
    sort.onchange = () => { filters.sort = sort.value; changed(); };
    root.querySelectorAll('[data-mistake-status]').forEach(button => button.onclick = () => { filters.status = button.dataset.mistakeStatus; changed(); });
    selectAll.onchange = () => { selected = new Set(selectAll.checked ? visible.map(m => m.id) : []); render(); };
    clear.onclick = () => { selected.clear(); render(); };
    practiceBtn.onclick = async () => {
        practiceBtn.disabled = true;
        try { await practice(selected.size ? visible.filter(m => selected.has(m.id)) : visible); }
        catch { alert('無法開始複習，請重試。'); }
        finally { updateSelection(); }
    };
    cardsBtn.onclick = async () => {
        const eligible = eligibleCards();
        console.log('[FlashcardGen] AI 一鍵製作字卡被點擊', {
            selectedCount: selected.size,
            eligibleCount: eligible.length,
            visibleCount: visible.length
        });
        cardsBtn.disabled = true;
        try {
            const items = selected.size ? eligible : eligible.slice(0, 30);
            console.log('[FlashcardGen] 準備製作字卡，題目數：', items.length);
            await makeCards(items);
            console.log('[FlashcardGen] 字卡對話框已成功啟動');
        } catch (e) {
            console.error('[FlashcardGen] 製作字卡失敗：', e);
            alert(e.message || '無法製作字卡，請重試。');
        } finally {
            updateSelection();
        }
    };
    const close = () => { menus.forEach(menu => menu.close()); request++; root.style.display = 'none'; document.body.style.overflow = ''; window.scrollTo(0, previousScrollY); opener?.focus({ preventScroll: true }); };
    root.querySelector('#closeMistakeViewBtn').onclick = close;
    root.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Tab') {
            const nodes = [...root.querySelectorAll('button, input, select, summary')].filter(n => !n.disabled && n.getClientRects().length);
            const first = nodes[0], last = nodes.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    });
    async function open(quizKey = null) {
        const token = ++request;
        if (root.style.display !== 'flex') { opener = document.activeElement; previousScrollY = window.scrollY; }
        const catalog = typeof getCatalog === 'function' ? getCatalog() : getCatalog;
        const archived = getArchivedBankKeys(catalog);
        filters.quiz = (quizKey && !isArchivedMistake(quizKey, archived)) ? quizKey : '';
        filters.subject = []; filters.query = ''; search.value = '';
        selected.clear(); limit = 30;
        root.style.display = 'flex'; window.scrollTo(0, 0); document.body.style.overflow = 'hidden';
        root.querySelector('#mistakeScrollContainer').scrollTop = 0;
        render(); search.focus();
        root.setAttribute('aria-busy', 'true');
        try { await refresh(); if (token === request) render(); }
        catch {
            if (token !== request) return;
            summary.textContent = '錯題同步失敗，目前顯示上次載入的紀錄。';
            const retry = el('button', 'secondary-button', '重試');
            retry.onclick = () => open(filters.quiz); summary.append(' ', retry);
        } finally { if (token === request) root.setAttribute('aria-busy', 'false'); }
    }
    return { open, close, render };
}
