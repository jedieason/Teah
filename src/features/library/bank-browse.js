import { quizLabel } from '../mistakes/model.js';
import { markdown, getOrderedOptionEntries, isAnswerMatch } from '../../shared/content.js';

export function mountBankBrowse({ root, readBank, getBankTitle = key => key, isStarred, toggleStar, renderMath, appendQuestionImage, alert = (typeof window !== 'undefined' ? window.alert : () => {}) }) {
    if (!root) return { open: () => {}, close: () => {} };

    const win = typeof window !== 'undefined' ? window : globalThis;

    const scrollContainer = root.querySelector('#bankBrowseScrollContainer');
    const subjectEl = root.querySelector('#bankBrowseSubject');
    const titleEl = root.querySelector('#bankBrowseTitle');
    const countEl = root.querySelector('#bankBrowseCount');
    const searchEl = root.querySelector('#bankBrowseSearch');
    const summaryEl = root.querySelector('#bankBrowseSummary');
    const tabSingle = root.querySelector('#bankBrowseTabSingle');
    const tabList = root.querySelector('#bankBrowseTabList');
    const toggleExplBtn = root.querySelector('#bankBrowseToggleExplanation');
    const closeBtn = root.querySelector('#closeBankBrowseBtn');
    const contentEl = root.querySelector('#bankBrowseContent');
    const bottomBar = root.querySelector('#bankBrowseBottomBar');
    const prevBtn = root.querySelector('#bankBrowsePrevBtn');
    const nextBtn = root.querySelector('#bankBrowseNextBtn');
    const pagerText = root.querySelector('#bankBrowseCurrentPage');

    let allQuestions = [];
    let visibleQuestions = [];
    let currentIndex = 0;
    let mode = 'single'; // 'single' | 'list'
    let showExplanation = true;
    let currentKey = '';
    let touchStartX = 0;
    let touchStartY = 0;

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    function createCard(q, displayIndex) {
        const card = document.createElement('article');
        card.className = 'review-card bank-browse-card';
        card.dataset.index = String(displayIndex);

        const meta = document.createElement('div');
        meta.className = 'review-meta';

        const numBadge = document.createElement('span');
        numBadge.className = 'bank-browse-question-num';
        numBadge.textContent = `第 ${displayIndex + 1} 題`;

        const sourceSpan = document.createElement('span');
        sourceSpan.className = 'review-source';
        if (q.origin) {
            sourceSpan.textContent = q.origin;
        }

        meta.append(numBadge, sourceSpan);

        if (typeof isStarred === 'function' && typeof toggleStar === 'function') {
            const starBtn = document.createElement('button');
            starBtn.className = 'review-star-btn star-btn';
            starBtn.type = 'button';
            starBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" aria-hidden="true"><path class="star-fill" d="m233-120 65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149Z"/><path class="star-outline" d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z"/></svg>`;
            const updateStarUi = active => {
                starBtn.classList.toggle('active', active);
                starBtn.setAttribute('aria-label', active ? '取消星號' : '標記星號');
                starBtn.title = active ? '取消星號' : '標記星號';
            };
            updateStarUi(Boolean(isStarred(q)));
            starBtn.onclick = async e => {
                e.stopPropagation();
                starBtn.disabled = true;
                try {
                    const next = await toggleStar(q);
                    updateStarUi(next);
                } catch (err) {
                    alert(err.message || '收藏狀態未儲存，請重試。');
                } finally {
                    starBtn.disabled = false;
                }
            };
            meta.append(starBtn);
        }

        const questionDiv = document.createElement('div');
        questionDiv.className = 'review-question';
        questionDiv.innerHTML = markdown(q.question);
        if (typeof appendQuestionImage === 'function') appendQuestionImage(questionDiv, q.image, { deferred: true });
        card.append(meta, questionDiv);

        if (q.options) {
            const list = document.createElement('div');
            list.className = 'review-options';
            getOrderedOptionEntries(q.options).forEach(([key, text]) => {
                const isCorrect = isAnswerMatch(key, text, q.answer);
                const row = document.createElement('div');
                row.className = isCorrect ? 'review-option is-answer' : 'review-option';
                if (isCorrect) row.dataset.answer = 'true';

                const label = document.createElement('span');
                label.className = 'review-option-label';
                label.textContent = key;
                row.append(label);

                const val = document.createElement('div');
                val.innerHTML = markdown(text);
                row.append(val);

                if (isCorrect) {
                    const badge = document.createElement('span');
                    badge.className = 'browse-answer-badge';
                    badge.textContent = '✓ 正確';
                    row.append(badge);
                }

                list.append(row);
            });
            card.append(list);
        } else if (q.answer != null) {
            const inline = document.createElement('div');
            inline.className = 'review-inline-answer';
            inline.style.display = 'block';
            inline.innerHTML = `<strong>正確答案：</strong>${Array.isArray(q.answer) ? q.answer.join('、') : q.answer}`;
            card.append(inline);
        }

        const details = document.createElement('details');
        details.className = 'review-answer';
        if (showExplanation) details.open = true;

        const summary = document.createElement('summary');
        summary.textContent = '查看答案與詳解';
        details.append(summary);

        const body = document.createElement('div');
        body.className = 'review-answer-body';

        const correctP = document.createElement('p');
        correctP.className = 'review-correct-answer';
        correctP.textContent = `正確答案：${Array.isArray(q.answer) ? q.answer.join('、') : q.answer ?? '尚未提供'}`;
        body.append(correctP);

        const explDiv = document.createElement('div');
        explDiv.className = 'review-explanation';
        explDiv.innerHTML = markdown(q.explanation || '尚無詳解');
        body.append(explDiv);

        if (q.origin) {
            const originP = document.createElement('p');
            originP.className = 'review-origin';
            originP.textContent = `出處：${q.origin}`;
            body.append(originP);
        }

        details.append(body);
        details.addEventListener('toggle', () => {
            if (details.open && typeof renderMath === 'function') renderMath(body);
        });
        card.append(details);

        if (typeof renderMath === 'function') renderMath(card);
        return card;
    }

    function renderView() {
        contentEl.replaceChildren();

        if (!visibleQuestions.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            const h3 = document.createElement('h3');
            h3.textContent = '沒有符合條件的題目';
            const p = document.createElement('p');
            p.textContent = '請試試其他關鍵字。';
            empty.append(h3, p);
            contentEl.append(empty);

            if (pagerText) pagerText.textContent = '0 / 0 題';
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) {
                nextBtn.disabled = true;
                nextBtn.textContent = '下一題';
            }
            return;
        }

        const frag = document.createDocumentFragment();
        visibleQuestions.forEach((q, i) => {
            const card = createCard(q, i);
            if (mode === 'single' && i === currentIndex) {
                card.classList.add('active');
            }
            frag.append(card);
        });
        contentEl.append(frag);
        updateNavigationUI();
    }

    function updateNavigationUI() {
        const total = visibleQuestions.length;
        if (!total) return;

        currentIndex = Math.max(0, Math.min(currentIndex, total - 1));

        if (mode === 'single') {
            const cards = contentEl.querySelectorAll('.bank-browse-card');
            cards.forEach((card, i) => {
                card.classList.toggle('active', i === currentIndex);
            });
            if (pagerText) pagerText.textContent = `第 ${currentIndex + 1} / ${total} 題`;
            if (prevBtn) prevBtn.disabled = currentIndex === 0;
            if (nextBtn) {
                const isLast = currentIndex === total - 1;
                nextBtn.disabled = isLast;
                nextBtn.textContent = isLast ? '已到最後一題' : '下一題';
            }
        }
    }

    function goTo(index) {
        if (!visibleQuestions.length) return;
        const target = Math.max(0, Math.min(index, visibleQuestions.length - 1));
        if (target === currentIndex) return;
        currentIndex = target;
        updateNavigationUI();
        if (scrollContainer) scrollContainer.scrollTop = 0;
    }

    function setMode(newMode) {
        mode = newMode;
        root.classList.toggle('mode-single', mode === 'single');
        root.classList.toggle('mode-list', mode === 'list');
        if (tabSingle) tabSingle.setAttribute('aria-pressed', String(mode === 'single'));
        if (tabList) tabList.setAttribute('aria-pressed', String(mode === 'list'));

        if (mode === 'single') {
            updateNavigationUI();
            if (scrollContainer) scrollContainer.scrollTop = 0;
        } else {
            // Scroll to current question in list view
            const activeCard = contentEl.querySelector(`.bank-browse-card[data-index="${currentIndex}"]`);
            if (activeCard) {
                activeCard.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    function toggleExplanation() {
        showExplanation = !showExplanation;
        if (toggleExplBtn) {
            toggleExplBtn.textContent = showExplanation ? '收合詳解' : '展開詳解';
        }
        const allDetails = contentEl.querySelectorAll('details.review-answer');
        allDetails.forEach(d => {
            d.open = showExplanation;
            if (showExplanation && typeof renderMath === 'function') {
                const body = d.querySelector('.review-answer-body');
                if (body) renderMath(body);
            }
        });
    }

    function filterQuestions() {
        const query = (searchEl?.value || '').trim().toLowerCase();
        if (!query) {
            visibleQuestions = [...allQuestions];
            if (summaryEl) summaryEl.textContent = '';
        } else {
            visibleQuestions = allQuestions.filter(q => {
                const stem = String(q.question || '').toLowerCase();
                if (stem.includes(query)) return true;
                if (q.origin && String(q.origin).toLowerCase().includes(query)) return true;
                if (q.explanation && String(q.explanation).toLowerCase().includes(query)) return true;
                if (q.options) {
                    for (const [k, v] of Object.entries(q.options)) {
                        if (String(k).toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) return true;
                    }
                }
                const ans = Array.isArray(q.answer) ? q.answer.join(' ') : String(q.answer || '');
                if (ans.toLowerCase().includes(query)) return true;
                return false;
            });
            if (summaryEl) summaryEl.textContent = `符合條件 ${visibleQuestions.length} 題 / 共 ${allQuestions.length} 題`;
        }
        currentIndex = 0;
        renderView();
    }

    function onKeyDown(e) {
        if (root.style.display === 'none') return;
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

        if (e.key === 'Escape') {
            close();
            return;
        }

        if (mode === 'single') {
            if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                e.preventDefault();
                goTo(currentIndex + 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                e.preventDefault();
                goTo(currentIndex - 1);
            }
        }
    }

    // Attach event listeners
    if (tabSingle) tabSingle.onclick = () => setMode('single');
    if (tabList) tabList.onclick = () => setMode('list');
    if (toggleExplBtn) toggleExplBtn.onclick = toggleExplanation;
    if (closeBtn) closeBtn.onclick = close;
    if (prevBtn) prevBtn.onclick = () => goTo(currentIndex - 1);
    if (nextBtn) nextBtn.onclick = () => goTo(currentIndex + 1);
    if (searchEl) searchEl.oninput = filterQuestions;

    if (scrollContainer) {
        scrollContainer.addEventListener('touchstart', e => {
            if (mode !== 'single') return;
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
        }, { passive: true });

        scrollContainer.addEventListener('touchend', e => {
            if (mode !== 'single') return;
            const touch = e.changedTouches[0];
            const diffX = touch.clientX - touchStartX;
            const diffY = touch.clientY - touchStartY;
            if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
                if (diffX < 0) {
                    goTo(currentIndex + 1);
                } else {
                    goTo(currentIndex - 1);
                }
            }
        }, { passive: true });
    }

    async function open(key, options = {}) {
        currentKey = key;
        const label = quizLabel(getBankTitle(key));
        if (subjectEl) subjectEl.textContent = label.subject;
        if (titleEl) titleEl.textContent = label.title;

        let loaded = [];
        if (options.questions && options.questions.length) {
            loaded = JSON.parse(JSON.stringify(options.questions));
        } else {
            loaded = await readBank(key);
        }

        if (!loaded || !loaded.length) {
            throw new Error('題庫沒有可供瀏覽的題目。');
        }

        allQuestions = loaded.map((q, i) => ({
            ...q,
            sourcePath: q.sourcePath || key,
            originalIndex: q.originalIndex ?? i
        }));

        if (options.orderMode === 'shuffle') {
            shuffle(allQuestions);
        } else if (options.orderMode === 'reverse') {
            allQuestions.reverse();
        }

        visibleQuestions = [...allQuestions];
        currentIndex = 0;
        showExplanation = true;
        if (toggleExplBtn) toggleExplBtn.textContent = '收合詳解';

        if (countEl) {
            countEl.textContent = options.isSkipRepeatMode
                ? `共 ${allQuestions.length} 題 · 非考古題`
                : `共 ${allQuestions.length} 題`;
        }
        if (searchEl) searchEl.value = '';
        if (summaryEl) summaryEl.textContent = '';

        setMode(mode);
        renderView();

        root.style.display = 'flex';
        if (typeof document !== 'undefined' && document.body) document.body.style.overflow = 'hidden';
        win.addEventListener?.('keydown', onKeyDown);
        if (scrollContainer) scrollContainer.scrollTop = 0;
    }

    function close() {
        root.style.display = 'none';
        if (typeof document !== 'undefined' && document.body) document.body.style.overflow = '';
        win.removeEventListener?.('keydown', onKeyDown);
    }

    return {
        open,
        close,
        getQuestions: () => allQuestions,
        setMode,
        goTo
    };
}
