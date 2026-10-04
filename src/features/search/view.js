import { markdown } from '../../shared/content.js';
import { quizLabel } from '../mistakes/model.js';
import { normalizeSearchText } from './model.js';
import { createSearchLoader } from './loader.js';

const node = (tag, text, parent, cls) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (cls) element.className = cls; parent?.append(element); return element; };
const button = (label, parent, action) => { const element = node('button', label, parent, 'quiet-button'); element.type = 'button'; element.onclick = action; return element; };
function plainText(value) {
    const root = document.createElement('div'); root.innerHTML = markdown(value);
    root.querySelectorAll('br').forEach(element => element.replaceWith(' '));
    root.querySelectorAll('p, li, tr, th, td, h1, h2, h3, h4, h5, h6, blockquote, pre').forEach(element => element.append(' '));
    return root.textContent;
}
function highlight(root, query) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), texts = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code, pre, .katex')) texts.push(walker.currentNode);
    for (const text of texts) {
        let normalized = '', offsets = [];
        for (const { segment: character, index: offset } of segmenter.segment(text.data)) {
            const part = character.normalize('NFKC').toLowerCase();
            for (const c of part) {
                if (/\s/u.test(c)) {
                    if (!normalized.endsWith(' ')) { normalized += ' '; offsets.push([offset, offset + character.length]); }
                    else offsets.at(-1)[1] = offset + character.length;
                } else { normalized += c; for (let i = 0; i < c.length; i++) offsets.push([offset, offset + character.length]); }
            }
        }
        let position = normalized.indexOf(query);
        if (position < 0) continue;
        const ranges = [];
        while (position >= 0) {
            const from = offsets[position][0], to = offsets[position + query.length - 1][1];
            if (ranges.length && from <= ranges.at(-1)[1]) ranges.at(-1)[1] = Math.max(to, ranges.at(-1)[1]);
            else ranges.push([from, to]);
            position = normalized.indexOf(query, position + query.length);
        }
        const fragment = document.createDocumentFragment(); let start = 0;
        for (const [from, to] of ranges) { fragment.append(text.data.slice(start, from)); node('mark', text.data.slice(from, to), fragment); start = to; }
        fragment.append(text.data.slice(start)); text.replaceWith(fragment);
    }
}

export function mountQuestionSearch({ input, host, readBank, getUser, getScope, renderMath, practice, filterBanks }) {
    const loader = createSearchLoader({ readBank, plainText });
    let request = 0, timer, composing = false, catalogReady = false;
    let results = [], limit = 20;
    const heading = node('h3', '題目搜尋結果', host);
    const status = node('p', '', host, 'question-search-status'); status.setAttribute('role', 'status');
    const retry = button('重試未載入題庫', host, () => void search()); retry.hidden = true;
    const list = node('div', null, host, 'question-search-list');
    const more = button('顯示更多題目', host, () => { limit += 20; renderResults(true); }); more.hidden = true;
    function cancel() {
        request++; clearTimeout(timer); host.hidden = true; host.setAttribute('aria-busy', 'false');
        list.replaceChildren(); results = []; more.hidden = true; retry.hidden = true;
    }
    function renderResults(append = false) {
        if (!append) list.replaceChildren();
        const query = normalizeSearchText(input.value);
        for (const { question: q, fields } of results.slice(append ? list.childElementCount : 0, limit)) {
            const card = node('article', null, list, 'question-search-card');
            const header = node('header', null, card, 'question-search-card-header');
            const label = quizLabel(q.sourcePath.replace(/^_Archive_/, ''));
            node('h4', `${label.subject} · ${label.title} · 第 ${q.originalIndex + 1} 題`, header);
            const go = button('練習此題', header, async () => {
                go.disabled = true; const uid = getUser();
                try { if (!uid) throw new Error('請先登入。'); await practice(q); }
                catch (error) { if (uid === getUser()) status.textContent = error.message || '無法開始練習，請重試。'; }
                finally { go.disabled = false; }
            });
            const matched = fields.filter(key => key !== 'question');
            node('p', [fields.includes('question') ? '符合題目' : '', matched.length ? `符合選項 ${matched.join('、')}` : ''].filter(Boolean).join(' · '), card, 'question-search-match');
            if (q.origin) node('p', q.origin, card, 'question-search-origin');
            const question = node('div', null, card, 'question-search-question'); question.innerHTML = markdown(q.question); renderMath(question); highlight(question, query);
            if (q.options) {
                const options = node('ol', null, card, 'question-search-options'); options.setAttribute('aria-label', '選項');
                for (const [key, value] of Object.entries(q.options)) {
                    const option = node('li', null, options); node('span', key, option, 'question-search-option-key');
                    const content = node('div', null, option); content.innerHTML = markdown(value); renderMath(content); highlight(content, query);
                }
            }
            const answer = node('details', null, card, 'question-search-answer'); node('summary', '答案與詳解', answer);
            let revealed = false;
            answer.ontoggle = () => {
                if (!answer.open || revealed) return;
                revealed = true;
                node('p', `答案：${Array.isArray(q.answer) ? q.answer.join('、') : q.answer || '未提供'}`, answer);
                node('div', null, answer).innerHTML = markdown(q.explanation || '尚無詳解'); renderMath(answer);
            };
        }
        more.hidden = results.length <= list.childElementCount;
        more.textContent = `顯示更多題目（${list.childElementCount}/${results.length}）`;
    }
    async function search() {
        clearTimeout(timer);
        const id = ++request, query = normalizeSearchText(input.value), scope = getScope(), uid = getUser();
        filterBanks(query); list.replaceChildren(); results = []; more.hidden = true; retry.hidden = true;
        host.hidden = !query || !['library', 'archive'].includes(scope);
        host.setAttribute('aria-busy', 'false');
        if (host.hidden) return;
        heading.textContent = scope === 'archive' ? '典藏題目搜尋結果' : '題目搜尋結果';
        if (!uid) { status.textContent = '請先登入以搜尋題目。'; return; }
        if (!catalogReady) { status.textContent = '等待題庫目錄載入…'; return; }
        host.setAttribute('aria-busy', 'true'); status.textContent = '載入題目中…';
        const current = () => id === request && uid === getUser() && scope === getScope();
        const loaded = await loader.load(scope === 'archive', progress => {
            if (current()) status.textContent = `載入題目中… ${progress.done}/${progress.total} 份題庫`;
        });
        if (!current() || !loaded) return;
        host.setAttribute('aria-busy', 'false');
        results = loaded.index.search(query, { archived: scope === 'archive' }); limit = 20;
        status.textContent = results.length ? `找到 ${results.length} 題` : '沒有符合的題目';
        if (loaded.failures.length) {
            status.textContent += ` · ${loaded.failures.length} 份題庫載入失敗，搜尋結果尚未完整`; retry.hidden = false;
        }
        renderResults();
    }
    function schedule() {
        cancel(); const query = normalizeSearchText(input.value); filterBanks(query);
        if (!query || composing || !['library', 'archive'].includes(getScope())) return;
        host.hidden = false; heading.textContent = getScope() === 'archive' ? '典藏題目搜尋結果' : '題目搜尋結果';
        status.textContent = '搜尋中…'; timer = setTimeout(() => void search(), 150);
    }
    input.addEventListener('input', schedule);
    input.addEventListener('compositionstart', () => { composing = true; cancel(); });
    input.addEventListener('compositionend', () => { composing = false; schedule(); });
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); input.value = ''; schedule(); } });
    return {
        refresh: schedule,
        cancel,
        setCatalog(value) { catalogReady = true; loader.setCatalog(value); schedule(); },
        resetForUser(uid) { loader.resetForUser(uid); cancel(); },
        catalogFailed() { catalogReady = false; loader.setCatalog(null); cancel(); }
    };
}
