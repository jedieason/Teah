import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnswerMatch } from '../src/shared/content.js';
import { mountBankBrowse } from '../src/features/library/bank-browse.js';

test('isAnswerMatch evaluates single, array, text and delimiter answers', () => {
    assert.equal(isAnswerMatch('A', '選項文字', 'A'), true);
    assert.equal(isAnswerMatch('a', '選項文字', 'A'), true);
    assert.equal(isAnswerMatch('B', '選項文字', 'A'), false);
    assert.equal(isAnswerMatch('A', '選項文字', ['A', 'C']), true);
    assert.equal(isAnswerMatch('B', '選項文字', ['A', 'C']), false);
    assert.equal(isAnswerMatch('A', '選項文字', 'A, C'), true);
    assert.equal(isAnswerMatch('C', '選項文字', 'A/C'), true);
    assert.equal(isAnswerMatch('A', 'True', null), false);
    assert.equal(isAnswerMatch('T', 'True', 'T'), true);
    assert.equal(isAnswerMatch('T', 'True', 'True'), true);
});

test('bankBrowse opens questions, handles single and list modes, search, and navigation', async () => {
    // Set up mock DOM
    const createEl = (tag, id, cls) => {
        const el = {
            tagName: tag.toUpperCase(),
            id,
            className: cls || '',
            dataset: {},
            style: {},
            classList: {
                classes: new Set((cls || '').split(' ').filter(Boolean)),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                toggle(c, force) {
                    if (force !== undefined) {
                        force ? this.classes.add(c) : this.classes.delete(c);
                        return force;
                    }
                    if (this.classes.has(c)) { this.classes.delete(c); return false; }
                    this.classes.add(c); return true;
                },
                contains(c) { return this.classes.has(c); }
            },
            attributes: {},
            setAttribute(k, v) { this.attributes[k] = String(v); },
            getAttribute(k) { return this.attributes[k]; },
            children: [],
            append(...nodes) { this.children.push(...nodes); },
            replaceChildren(...nodes) { this.children = [...nodes]; },
            querySelector(sel) {
                const search = (node) => {
                    if (sel.startsWith('#') && node.id === sel.slice(1)) return node;
                    if (sel.startsWith('.') && node.classList?.contains(sel.slice(1))) return node;
                    for (const child of (node.children || [])) {
                        const found = search(child);
                        if (found) return found;
                    }
                    return null;
                };
                return search(this);
            },
            querySelectorAll(sel) {
                const results = [];
                const search = (node) => {
                    if (sel.startsWith('.') && node.classList?.contains(sel.slice(1))) results.push(node);
                    if (node.tagName && sel.toLowerCase() === node.tagName.toLowerCase()) results.push(node);
                    for (const child of (node.children || [])) search(child);
                };
                for (const child of (this.children || [])) search(child);
                return results;
            },
            addEventListener(ev, fn) { this._listeners = this._listeners || {}; (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
            removeEventListener(ev, fn) { if (this._listeners?.[ev]) this._listeners[ev] = this._listeners[ev].filter(f => f !== fn); },
            scrollIntoView() {}
        };
        return el;
    };

    const mockRoot = createEl('section', 'bankBrowseView');
    const scrollContainer = createEl('div', 'bankBrowseScrollContainer');
    const subjectEl = createEl('span', 'bankBrowseSubject');
    const titleEl = createEl('h2', 'bankBrowseTitle');
    const countEl = createEl('span', 'bankBrowseCount');
    const searchEl = createEl('input', 'bankBrowseSearch');
    searchEl.value = '';
    const summaryEl = createEl('p', 'bankBrowseSummary');
    const tabSingle = createEl('button', 'bankBrowseTabSingle');
    const tabList = createEl('button', 'bankBrowseTabList');
    const toggleExplBtn = createEl('button', 'bankBrowseToggleExplanation');
    const closeBtn = createEl('button', 'closeBankBrowseBtn');
    const contentEl = createEl('div', 'bankBrowseContent');
    const bottomBar = createEl('footer', 'bankBrowseBottomBar');
    const prevBtn = createEl('button', 'bankBrowsePrevBtn');
    const nextBtn = createEl('button', 'bankBrowseNextBtn');
    const pagerText = createEl('span', 'bankBrowseCurrentPage');

    mockRoot.append(
        scrollContainer, subjectEl, titleEl, countEl, searchEl, summaryEl,
        tabSingle, tabList, toggleExplBtn, closeBtn, contentEl, bottomBar,
        prevBtn, nextBtn, pagerText
    );

    // Mock global document if not present in Node
    const originalDoc = globalThis.document;
    globalThis.document = {
        createElement: (tag) => createEl(tag),
        createDocumentFragment: () => {
            const frag = { children: [], append(...nodes) { this.children.push(...nodes); } };
            return frag;
        },
        body: { style: {} }
    };

    // Mock DOMPurify and marked for markdown() helper
    const originalPurify = globalThis.DOMPurify;
    const originalMarked = globalThis.marked;
    globalThis.DOMPurify = { sanitize: text => text };
    globalThis.marked = { parse: text => `<p>${text}</p>` };

    try {
        const sampleQuestions = [
            { question: '第一題問題', options: { A: '甲', B: '乙' }, answer: 'A', explanation: '甲詳解', origin: '109 年' },
            { question: '第二題問題', options: { A: '丙', B: '丁' }, answer: 'B', explanation: '丁詳解' },
            { question: '簡答題問題', answer: '關鍵字', explanation: '簡答詳解' }
        ];

        let starredSet = new Set();
        const browse = mountBankBrowse({
            root: mockRoot,
            readBank: async () => sampleQuestions,
            getBankTitle: key => key,
            isStarred: q => starredSet.has(q.question),
            toggleStar: async q => {
                if (starredSet.has(q.question)) { starredSet.delete(q.question); return false; }
                starredSet.add(q.question); return true;
            },
            renderMath: () => {},
            alert: () => {}
        });

        // Open in browse mode
        await browse.open('藥理區段一｜抗生素', { orderMode: 'sequential' });

        assert.equal(subjectEl.textContent, '藥理區段一');
        assert.equal(titleEl.textContent, '抗生素');
        assert.equal(countEl.textContent, '共 3 題');
        assert.equal(mockRoot.style.display, 'flex');
        assert.equal(mockRoot.classList.contains('mode-single'), true);
        assert.equal(pagerText.textContent, '第 1 / 3 題');
        assert.equal(prevBtn.disabled, true);
        assert.equal(nextBtn.disabled, false);

        // Next question
        browse.goTo(1);
        assert.equal(pagerText.textContent, '第 2 / 3 題');
        assert.equal(prevBtn.disabled, false);
        assert.equal(nextBtn.disabled, false);

        // Next to last question
        browse.goTo(2);
        assert.equal(pagerText.textContent, '第 3 / 3 題');
        assert.equal(prevBtn.disabled, false);
        assert.equal(nextBtn.disabled, true);
        assert.equal(nextBtn.textContent, '已到最後一題');

        // Switch to list mode
        browse.setMode('list');
        assert.equal(mockRoot.classList.contains('mode-list'), true);

        // Test reverse order
        await browse.open('藥理區段一｜抗生素', { orderMode: 'reverse' });
        const questions = browse.getQuestions();
        assert.equal(questions[0].question, '簡答題問題');
        assert.equal(questions[2].question, '第一題問題');

        // Close
        browse.close();
        assert.equal(mockRoot.style.display, 'none');
    } finally {
        globalThis.document = originalDoc;
        globalThis.DOMPurify = originalPurify;
        globalThis.marked = originalMarked;
    }
});
