import { reviewQuestions, reviewRequest, parseReview } from './model.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function mountConceptReview(parent, { questions, source, getKey }) {
    const items = reviewQuestions(questions, source);
    const section = el('section', 'concept-review');
    section.setAttribute('aria-label', 'AI 觀念回顧');
    section.append(el('h2', '', '觀念回顧'));
    parent.append(section);
    if (!items.length) {
        section.append(el('p', 'concept-status', '本次全部答對，沒有需要回顧的錯題。'));
        return;
    }
    section.append(el('p', 'concept-note', 'AI 整合本次所有錯題，整理優先複習方向與記憶重點。'));
    const status = el('p', 'concept-status'); status.setAttribute('role', 'status');
    const retry = el('button', 'secondary-button', '重新生成觀念回顧');
    retry.type = 'button'; retry.hidden = true;
    const content = el('div', 'concept-content');
    section.append(status, retry, content);
    let running = false;
    const controller = new AbortController();
    const observer = new MutationObserver(() => {
        if (!section.isConnected) { controller.abort(); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function render(data) {
        content.replaceChildren();
        content.append(el('p', 'concept-summary', data.summary));
        const heading = el('div', 'concept-section-heading');
        heading.append(el('h3', '', '接下來讀什麼'), el('span', '', '依建議優先順序'));
        content.append(heading);
        const areas = el('ol', 'concept-areas');
        data.studyAreas.forEach((area, index) => {
            const card = el('li', 'concept-area');
            const top = el('div', 'concept-area-heading');
            top.append(el('span', 'concept-order', String(index + 1).padStart(2, '0')));
            const title = el('div'); title.append(el('p', 'concept-unit', area.unit), el('h4', '', area.title));
            top.append(title, el('span', 'concept-count', `${area.questionIds.length} 題`));
            const track = el('div', 'concept-track'); track.setAttribute('aria-hidden', 'true');
            const bar = el('span'); bar.style.width = `${area.questionIds.length / items.length * 100}%`; track.append(bar);
            card.append(top, track);
            const details = el('dl', 'concept-study-details');
            details.append(el('dt', '', '可能盲點'), el('dd', '', area.blindSpot), el('dt', '', '閱讀範圍'), el('dd', '', area.studyFocus));
            card.append(details);
            const evidence = el('details', 'concept-evidence');
            evidence.append(el('summary', '', `相關錯題 · ${area.questionIds.map(id => items.find(q => q.questionId === id).position).join('、')}`));
            area.questionIds.forEach(id => {
                const q = items.find(q => q.questionId === id);
                evidence.append(el('p', '', `第 ${q.position} 題 · ${q.question}`));
            });
            card.append(evidence); areas.append(card);
        });
        content.append(areas, el('p', 'concept-note', '橫條表示本次錯題分布，並非單元掌握率。'));
        const memoryHeading = el('div', 'concept-section-heading');
        memoryHeading.append(el('h3', '', '現在先記住'), el('span', '', `${data.remember.length} 個核心觀念`)); content.append(memoryHeading);
        const memory = el('div', 'concept-memory-grid');
        data.remember.forEach(item => {
            const card = el('article', 'concept-memory');
            card.append(el('h4', '', item.concept), el('p', 'concept-rule', item.rule));
            const contrast = el('div', 'concept-distinction');
            contrast.append(el('span', '', '別混淆'), el('p', '', item.distinction)); card.append(contrast); memory.append(card);
        });
        content.append(memory);
        if (data.uncertainty) content.append(el('p', 'concept-uncertainty', `待核對 · ${data.uncertainty}`));
        content.append(el('p', 'concept-note', '盲點是依作答推測；AI 整理內容請搭配題庫詳解與教材核對。'));
    }

    async function generate() {
        if (running || controller.signal.aborted) return;
        running = true; retry.hidden = true; section.setAttribute('aria-busy', 'true');
        status.textContent = `正在整合 ${items.length} 題錯題，歸納共同觀念與複習方向…`;
        const timeout = new AbortController();
        const abort = () => timeout.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 90000);
        try {
            const key = await Promise.race([getKey(), new Promise((_, reject) => {
                timeout.signal.addEventListener('abort', () => reject(new Error('回顧逾時')), { once: true });
            })]);
            if (controller.signal.aborted) return;
            if (typeof key !== 'string' || !key.trim()) throw new Error('AI 服務尚未設定');
            // One request includes every wrong answer; the model synthesizes a single overview.
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: timeout.signal,
                body: JSON.stringify(reviewRequest(items))
            });
            if (!response.ok) throw new Error('AI 服務暫時無法使用');
            const data = await response.json();
            const candidate = data.candidates?.[0];
            if (candidate?.finishReason !== 'STOP') throw new Error('回顧未完整生成');
            const overview = parseReview(candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join(''), items);
            if (controller.signal.aborted) return;
            render(overview);
            status.textContent = `${items.length} 題錯題 → ${overview.studyAreas.length} 個複習方向`;
        } catch {
            if (!controller.signal.aborted) {
                status.textContent = '暫時無法生成完整回顧，請稍後重試。'; retry.hidden = false;
            }
        } finally {
            clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
            running = false; section.setAttribute('aria-busy', 'false');
        }
    }
    retry.addEventListener('click', generate);
    void generate();
}
