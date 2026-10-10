import { prepareMistakeFlashcardSources, generationRequest, parseGeneratedDeck, FLASHCARD_GLOSSARY_INSTRUCTIONS } from './generation.js';
import { loadDecks, saveDeck } from './service.js';
import { id } from './model.js';
import { auth } from '../../services/firebase.js';
import { streamGemini } from '../../services/gemini-stream.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function mountReviewFlashcards(parent, { questions, source, vocabulary, getKey, signal, showAlert, onOpenDeck }) {
    const wrongQuestions = (Array.isArray(questions) ? questions : []).filter(q => q.isAnswered && !q.isCorrect);
    const section = el('section', 'review-flashcards');
    section.setAttribute('aria-label', '重點字卡');

    const showMsg = (message, callback) => {
        if (typeof showAlert === 'function') {
            showAlert(message, callback);
        } else if (typeof window.showCustomAlert === 'function') {
            window.showCustomAlert(message, callback);
        } else {
            alert(message);
            callback?.();
        }
    };

    const openDeck = (deckId) => {
        if (typeof onOpenDeck === 'function') {
            onOpenDeck(deckId);
        } else if (typeof window.returnHome === 'function') {
            window.returnHome();
            vocabulary?.openDeck?.(deckId);
        } else {
            vocabulary?.openDeck?.(deckId);
        }
    };

    if (!wrongQuestions.length) {
        section.append(el('h2', '', '重點字卡'));
        section.append(el('p', 'review-flashcards-status', '本次全部答對，沒有需要複習的錯題字卡。'));
        parent.append(section);
        return { abort: () => {} };
    }

    const header = el('div', 'review-flashcards-header');
    header.append(el('h2', '', '重點字卡'));

    const actionsBar = el('div', 'review-flashcards-actions');
    actionsBar.hidden = true;

    const addBtn = el('button', 'secondary-button review-btn-add', '加入字卡集');
    addBtn.type = 'button';

    const mergeBtn = el('button', 'secondary-button review-btn-merge', '併入既有字卡');
    mergeBtn.type = 'button';

    actionsBar.append(addBtn, mergeBtn);
    header.append(actionsBar);

    const status = el('p', 'review-flashcards-status');
    status.setAttribute('role', 'status');

    const retryBtn = el('button', 'secondary-button review-btn-retry', '重新生成字卡');
    retryBtn.type = 'button';
    retryBtn.hidden = true;

    const cardList = el('div', 'review-flashcards-list');

    section.append(header, status, retryBtn, cardList);
    parent.append(section);

    let running = false;
    let currentDeck = null;
    let savedNewDeckId = null;
    let isSavingNew = false;
    let isMerging = false;

    const controller = new AbortController();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    const observer = new MutationObserver(() => {
        if (!section.isConnected) {
            controller.abort();
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function renderCards(deck) {
        status.textContent = `${deck.cards.length} 張重點字卡`;
        actionsBar.hidden = false;
        cardList.replaceChildren();

        deck.cards.forEach(card => {
            const item = el('article', 'review-flashcard-item');
            const termEl = el('div', 'review-flashcard-term', card.term);
            const defEl = el('div', 'review-flashcard-definition', card.definition);
            item.append(termEl, defEl);
            cardList.append(item);
        });
    }

    function openMergeDialog(userDecks, generatedDeck, onMerged) {
        const dialog = document.createElement('dialog');
        dialog.className = 'vocab-dialog review-merge-dialog';
        dialog.setAttribute('aria-label', '併入既有字卡');

        const body = el('div', 'vocab-dialog-body');
        const head = el('div', 'vocab-heading');
        head.append(el('h2', '', '選擇要併入的字卡集'));

        const count = generatedDeck.cards.length;
        const desc = el('p', 'vocab-muted', `將 ${count} 張字卡併入以下選取的字卡集：`);
        const list = el('div', 'review-merge-deck-list');

        userDecks.forEach(targetDeck => {
            const itemBtn = el('button', 'review-merge-deck-item');
            itemBtn.type = 'button';
            const nameSpan = el('span', 'review-merge-deck-name', targetDeck.title);
            const countSpan = el('span', 'review-merge-deck-count', `${(targetDeck.cards || []).length} 張字卡`);
            itemBtn.append(nameSpan, countSpan);

            itemBtn.onclick = async () => {
                itemBtn.disabled = true;
                itemBtn.textContent = '併入中…';
                try {
                    const existingCards = targetDeck.cards || [];
                    const newCards = generatedDeck.cards.map(c => ({
                        id: id(),
                        term: c.term.trim(),
                        definition: c.definition.trim(),
                        termAliases: c.termAliases || [],
                        definitionAliases: c.definitionAliases || []
                    }));
                    const updated = {
                        ...targetDeck,
                        cards: [...existingCards, ...newCards]
                    };
                    const saved = await saveDeck(updated, targetDeck);
                    dialog.close();
                    dialog.remove();

                    const msg = `已將 ${newCards.length} 張字卡併入「${saved.title}」（現共 ${saved.cards.length} 張）。`;
                    showMsg(msg, () => openDeck(saved.id));
                    onMerged?.(saved);
                } catch (err) {
                    itemBtn.disabled = false;
                    itemBtn.replaceChildren(nameSpan, countSpan);
                    showMsg(err.message || '併入失敗，請重試。');
                }
            };
            list.append(itemBtn);
        });

        const actions = el('div', 'vocab-dialog-actions');
        const cancelBtn = el('button', 'secondary-button', '取消');
        cancelBtn.type = 'button';
        cancelBtn.onclick = () => {
            dialog.close();
            dialog.remove();
        };
        actions.append(cancelBtn);

        body.append(head, desc, list, actions);
        dialog.append(body);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
    }

    addBtn.onclick = async () => {
        if (savedNewDeckId) {
            openDeck(savedNewDeckId);
            return;
        }
        if (!auth.currentUser) {
            showMsg('登入後即可建立字卡集。');
            return;
        }
        if (!currentDeck || isSavingNew) return;
        isSavingNew = true;
        addBtn.disabled = true;
        addBtn.textContent = '儲存中…';

        try {
            const draft = {
                title: currentDeck.title || '錯題字卡',
                description: currentDeck.description || '',
                termLanguage: currentDeck.termLanguage || 'zh-TW',
                definitionLanguage: currentDeck.definitionLanguage || 'zh-TW',
                cards: currentDeck.cards.map(c => ({
                    id: id(),
                    term: c.term.trim(),
                    definition: c.definition.trim(),
                    termAliases: c.termAliases || [],
                    definitionAliases: c.definitionAliases || []
                }))
            };
            const saved = await saveDeck(draft);
            savedNewDeckId = saved.id;
            addBtn.disabled = false;
            addBtn.textContent = '查看字卡集';
            showMsg(`已建立字卡集「${saved.title}」（${saved.cards.length} 張）。`, () => openDeck(saved.id));
        } catch (e) {
            addBtn.disabled = false;
            addBtn.textContent = '加入字卡集';
            showMsg(e.message || '儲存字卡集失敗，請重試。');
        } finally {
            isSavingNew = false;
        }
    };

    mergeBtn.onclick = async () => {
        if (!auth.currentUser) {
            showMsg('登入後即可管理字卡。');
            return;
        }
        if (!currentDeck || isMerging) return;
        isMerging = true;
        mergeBtn.disabled = true;

        try {
            const { decks } = await loadDecks();
            const uid = auth.currentUser.uid;
            const userDecks = Object.values(decks || {}).filter(d => !d.deletedAt && (!d.authorId || d.authorId === uid));

            if (!userDecks.length) {
                showMsg('尚無既有字卡集，請直接點擊「加入字卡集」建立。');
                return;
            }

            openMergeDialog(userDecks, currentDeck, (mergedDeck) => {
                mergeBtn.textContent = `已併入「${mergedDeck.title}」`;
                mergeBtn.onclick = () => openDeck(mergedDeck.id);
            });
        } catch (e) {
            showMsg(e.message || '讀取字卡集失敗，請重試。');
        } finally {
            mergeBtn.disabled = false;
            isMerging = false;
        }
    };

    async function generate() {
        if (running || controller.signal.aborted) return;
        running = true;
        retryBtn.hidden = true;
        actionsBar.hidden = true;
        cardList.replaceChildren();
        section.setAttribute('aria-busy', 'true');
        status.textContent = `正在由 ${wrongQuestions.length} 題錯題歸納重點並生成字卡…`;

        const timeout = new AbortController();
        const abort = () => timeout.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, 90000);

        try {
            const sources = prepareMistakeFlashcardSources(questions, source);
            const req = generationRequest(sources, FLASHCARD_GLOSSARY_INSTRUCTIONS);
            let generatedText = '';
            let streamWorked = false;

            // Try server streaming first
            try {
                generatedText = await streamGemini({
                    contents: req.contents,
                    config: {
                        systemInstruction: req.systemInstruction?.parts?.[0]?.text,
                        ...req.generationConfig
                    },
                    signal: timeout.signal,
                    onStart: () => {
                        status.textContent = '正在分析錯題與核心名詞…';
                    },
                    onDelta: (_delta, accumulated) => {
                        status.textContent = `正在生成字卡… (${accumulated.length} 字)`;
                    }
                });
                if (generatedText) streamWorked = true;
            } catch {
                if (controller.signal.aborted || timeout.signal.aborted) return;
            }

            if (!streamWorked) {
                const key = await Promise.race([getKey(), new Promise((_, reject) => {
                    timeout.signal.addEventListener('abort', () => reject(new DOMException('生成逾時', 'AbortError')), { once: true });
                })]);
                if (controller.signal.aborted) return;
                if (typeof key !== 'string' || !key.trim()) throw new Error('AI 服務尚未設定');
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: timeout.signal,
                    body: JSON.stringify(req)
                });
                if (!response.ok) throw new Error('AI 服務暫時無法使用');
                const data = await response.json();
                const candidate = data.candidates?.[0];
                if (candidate?.finishReason !== 'STOP') throw new Error('字卡未完整生成');
                generatedText = candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
            }

            if (controller.signal.aborted) return;
            const cleaned = (generatedText || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            const deck = parseGeneratedDeck(cleaned, sources);
            currentDeck = deck;
            renderCards(deck);
        } catch (err) {
            if (!controller.signal.aborted) {
                status.textContent = err.message || '暫時無法生成字卡，請稍後重試。';
                retryBtn.hidden = false;
            }
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', abort);
            running = false;
            section.setAttribute('aria-busy', 'false');
        }
    }

    retryBtn.onclick = generate;
    void generate();

    return { abort: () => controller.abort() };
}
