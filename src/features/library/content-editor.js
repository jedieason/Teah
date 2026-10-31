import { validateQuiz } from '../../shared/content.js';

export function parseBankLabel(key) {
    const clean = (key || '').replace(/^_Archive_/, ''), split = clean.indexOf('｜');
    return split < 0 ? { subject: '其他', title: clean } : { subject: clean.slice(0, split), title: clean.slice(split + 1) };
}

export function validateQuestionPayload(raw, mode) {
    let parsed;
    if (typeof raw === 'string') {
        const text = raw.trim();
        if (!text) throw new Error('內容不可為空。');
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new Error(`JSON 語法錯誤：${e.message}`);
        }
    } else {
        parsed = raw;
    }

    if (mode === 'bank' || mode === 'batch') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('整個題庫內容必須是包含 banks 陣列的 JSON 物件（{ "banks": [...] }）。');
        }
        let banksList;
        if (Array.isArray(parsed.banks)) {
            banksList = parsed.banks;
        } else {
            // Support key-value map { "題庫標題": [ ... ] }
            const entries = Object.entries(parsed);
            if (!entries.length) throw new Error('題庫列表不可為空。');
            banksList = entries.map(([title, questions]) => ({ title, questions }));
        }

        if (!banksList.length) throw new Error('題庫列表不可為空。');
        const seenTitles = new Set();
        const validatedBanks = banksList.map((b, i) => {
            if (!b || typeof b !== 'object') throw new Error(`第 ${i + 1} 份題庫格式不正確。`);
            const title = typeof b.title === 'string' ? b.title.trim() : '';
            if (!title) throw new Error(`第 ${i + 1} 份題庫缺少標題。`);
            if (/[.#$\[\]/\x00-\x1f\x7f]/.test(title)) throw new Error(`第 ${i + 1} 份題庫標題「${title}」不可包含 . # $ [ ] / 或控制字元。`);
            if (seenTitles.has(title)) throw new Error(`題庫標題「${title}」重複。`);
            seenTitles.add(title);
            if (!Array.isArray(b.questions)) throw new Error(`第 ${i + 1} 份題庫「${title}」缺少題目陣列。`);
            try {
                validateQuiz(b.questions);
            } catch (err) {
                throw new Error(`第 ${i + 1} 份題庫「${title}」題目格式不正確：${err.message}`);
            }
            return { title, questions: b.questions };
        });
        return { banks: validatedBanks };
    }

    if (mode === 'unit') {
        if (!Array.isArray(parsed)) throw new Error('整個單元內容必須為題目 JSON 陣列（以 [ 開頭）。');
        validateQuiz(parsed);
        return parsed;
    }

    // Single mode: allow single question object or single-element array
    let questionObj = parsed;
    if (Array.isArray(parsed)) {
        if (parsed.length !== 1) throw new Error('單一題目模式請輸入單一題目物件（{ ... }）。');
        questionObj = parsed[0];
    }
    if (!questionObj || typeof questionObj !== 'object') throw new Error('單一題目格式不正確，必須是物件。');
    validateQuiz([questionObj]);
    return questionObj;
}

export function formatQuestionJson(data) {
    return JSON.stringify(data, null, 2);
}

export function mergeQuestionEdit(allQuestions, updatedQuestion, index) {
    if (!Array.isArray(allQuestions)) throw new Error('題庫資料格式不正確。');
    if (index < 0 || index >= allQuestions.length) throw new Error('題目序號超出範圍。');
    const original = allQuestions[index] || {};
    const merged = {
        ...updatedQuestion,
        questionId: updatedQuestion.questionId || original.questionId,
        revision: (original.revision || 1) + 1,
    };
    if (original.taxonomy && !updatedQuestion.taxonomy) {
        merged.taxonomy = original.taxonomy;
    }
    const nextList = [...allQuestions];
    nextList[index] = merged;
    validateQuiz(nextList);
    return nextList;
}

export function mountContentEditor({ readBank, writeBanks, readCatalog, onChanged, getUser }) {
    const $ = id => document.getElementById(id);
    const modal = $('bankContentEditModal');
    if (!modal) return { open: () => {}, close: () => {} };

    const subjectEl = $('bankContentEditSubject');
    const titleEl = $('bankContentEditTitle');
    const closeBtn = $('bankContentEditCloseBtn');
    const cancelBtn = $('bankContentEditCancelBtn');
    const saveBtn = $('bankContentEditSaveBtn');
    const copyBtn = $('bankEditCopyBtn');
    const formatBtn = $('bankEditFormatBtn');
    const tabBank = $('bankEditScopeBank');
    const tabAll = $('bankEditScopeAll');
    const tabSingle = $('bankEditScopeSingle');
    const unitPickerWrap = $('bankEditUnitPickerWrap');
    const unitSelect = $('bankEditUnitSelect');
    const pickerWrap = $('bankEditQuestionPickerWrap');
    const questionSelect = $('bankEditQuestionSelect');
    const textarea = $('bankContentEditTextarea');
    const metaInfo = $('bankEditMetaInfo');
    const errorEl = $('bankContentEditError');
    const statusEl = $('bankContentEditStatus');

    let currentBanks = [];
    let originalBankKeys = [];
    let currentBankIndex = 0;
    let currentQuestionIndex = 0;
    let currentMode = 'unit'; // 'bank' | 'unit' | 'single'
    let currentSubject = '';
    let isSaving = false;

    function showError(msg) {
        if (!errorEl) return;
        if (msg) {
            errorEl.textContent = msg;
            errorEl.hidden = false;
        } else {
            errorEl.textContent = '';
            errorEl.hidden = true;
        }
    }

    function showStatus(msg) {
        if (!statusEl) return;
        if (msg) {
            statusEl.textContent = msg;
            statusEl.hidden = false;
        } else {
            statusEl.textContent = '';
            statusEl.hidden = true;
        }
    }

    function updateUnitPicker() {
        if (!unitSelect) return;
        unitSelect.replaceChildren();
        currentBanks.forEach((b, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            const label = parseBankLabel(b.title);
            opt.textContent = `${label.title || b.title} (${(b.questions || []).length} 題)`;
            unitSelect.append(opt);
        });
        unitSelect.value = String(currentBankIndex);
    }

    function updateQuestionPicker() {
        if (!questionSelect) return;
        questionSelect.replaceChildren();
        const curBank = currentBanks[currentBankIndex] || { questions: [] };
        const questions = curBank.questions || [];
        questions.forEach((q, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            const snippet = (q.question || '').replace(/\s+/g, ' ').slice(0, 32);
            opt.textContent = `第 ${i + 1} 題：${snippet || '(無題幹)'}`;
            questionSelect.append(opt);
        });
        questionSelect.value = String(currentQuestionIndex);
    }

    function syncTextarea() {
        if (!currentBanks.length) {
            currentBanks = [{ title: currentSubject || '新題庫', questions: [] }];
        }
        if (currentBankIndex < 0 || currentBankIndex >= currentBanks.length) {
            currentBankIndex = 0;
        }
        const curBank = currentBanks[currentBankIndex];
        const questions = curBank?.questions || [];
        if (currentQuestionIndex < 0 || (questions.length > 0 && currentQuestionIndex >= questions.length)) {
            currentQuestionIndex = 0;
        }

        if (currentMode === 'bank') {
            textarea.value = formatQuestionJson({ banks: currentBanks });
            const totalQ = currentBanks.reduce((sum, b) => sum + (b.questions?.length || 0), 0);
            if (metaInfo) metaInfo.textContent = `共 ${currentBanks.length} 份題庫 · ${totalQ} 題`;
            tabBank?.classList.add('active');
            tabBank?.setAttribute('aria-selected', 'true');
            tabAll?.classList.remove('active');
            tabAll?.setAttribute('aria-selected', 'false');
            tabSingle?.classList.remove('active');
            tabSingle?.setAttribute('aria-selected', 'false');
            if (unitPickerWrap) unitPickerWrap.hidden = true;
            if (pickerWrap) pickerWrap.hidden = true;
        } else if (currentMode === 'unit') {
            textarea.value = formatQuestionJson(questions);
            if (metaInfo) metaInfo.textContent = `共 ${questions.length} 題`;
            tabBank?.classList.remove('active');
            tabBank?.setAttribute('aria-selected', 'false');
            tabAll?.classList.add('active');
            tabAll?.setAttribute('aria-selected', 'true');
            tabSingle?.classList.remove('active');
            tabSingle?.setAttribute('aria-selected', 'false');
            if (unitPickerWrap) {
                unitPickerWrap.hidden = currentBanks.length <= 1;
                updateUnitPicker();
            }
            if (pickerWrap) pickerWrap.hidden = true;
        } else {
            const q = questions[currentQuestionIndex] || {};
            textarea.value = formatQuestionJson(q);
            if (metaInfo) metaInfo.textContent = `第 ${questions.length ? currentQuestionIndex + 1 : 0} / ${questions.length} 題`;
            tabBank?.classList.remove('active');
            tabBank?.setAttribute('aria-selected', 'false');
            tabAll?.classList.remove('active');
            tabAll?.setAttribute('aria-selected', 'false');
            tabSingle?.classList.add('active');
            tabSingle?.setAttribute('aria-selected', 'true');
            if (unitPickerWrap) {
                unitPickerWrap.hidden = currentBanks.length <= 1;
                updateUnitPicker();
            }
            if (pickerWrap) {
                pickerWrap.hidden = false;
                updateQuestionPicker();
            }
        }
    }

    function commitTextareaChanges() {
        if (currentMode === 'bank') {
            const parsed = validateQuestionPayload(textarea.value, 'bank');
            currentBanks = parsed.banks;
        } else if (currentMode === 'unit') {
            const parsed = validateQuestionPayload(textarea.value, 'unit');
            if (!currentBanks[currentBankIndex]) {
                currentBanks[currentBankIndex] = { title: currentSubject || '新題庫', questions: [] };
            }
            currentBanks[currentBankIndex].questions = parsed;
        } else {
            const parsed = validateQuestionPayload(textarea.value, 'single');
            if (!currentBanks[currentBankIndex]) {
                currentBanks[currentBankIndex] = { title: currentSubject || '新題庫', questions: [] };
            }
            currentBanks[currentBankIndex].questions = mergeQuestionEdit(currentBanks[currentBankIndex].questions, parsed, currentQuestionIndex);
        }
    }

    function switchMode(nextMode) {
        if (currentMode === nextMode) return;
        try {
            commitTextareaChanges();
            showError('');
        } catch (e) {
            showError(`切換模式前請先確認目前 JSON 格式正確：${e.message}`);
            return;
        }
        currentMode = nextMode;
        if (currentBankIndex >= currentBanks.length) currentBankIndex = 0;
        const curQCount = (currentBanks[currentBankIndex]?.questions || []).length;
        if (currentQuestionIndex >= curQCount) currentQuestionIndex = 0;
        syncTextarea();
    }

    function close() {
        if (isSaving) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        showError('');
        showStatus('');
        currentBanks = [];
        originalBankKeys = [];
        currentBankIndex = 0;
        currentQuestionIndex = 0;
        currentSubject = '';
    }

    async function open(target, questionIndex = null, options = {}) {
        const uid = getUser?.();
        if (!uid) {
            alert('請先登入後再編輯題庫。');
            return;
        }

        showError('');
        showStatus('');
        if (textarea) {
            textarea.value = '載入題目中…';
            textarea.disabled = true;
        }
        if (saveBtn) saveBtn.disabled = true;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        let bankKeysToLoad = [];
        let initialMode = 'unit';
        let targetBankKey = null;

        if (typeof target === 'object' && target !== null) {
            currentSubject = target.subject || '';
            bankKeysToLoad = Array.isArray(target.banks) ? target.banks : [];
            initialMode = target.mode || (bankKeysToLoad.length > 1 ? 'bank' : 'unit');
            targetBankKey = target.bankKey || bankKeysToLoad[0] || null;
        } else if (options?.isFolder) {
            currentSubject = target;
            bankKeysToLoad = Array.isArray(options.banks) ? options.banks : [];
            initialMode = options.mode || 'bank';
            targetBankKey = bankKeysToLoad[0] || null;
        } else if (typeof target === 'string' && Array.isArray(questionIndex)) {
            currentSubject = target;
            bankKeysToLoad = questionIndex;
            initialMode = 'bank';
            targetBankKey = bankKeysToLoad[0] || null;
        } else {
            targetBankKey = target;
            const label = parseBankLabel(targetBankKey);
            currentSubject = label.subject;
            bankKeysToLoad = options?.banks || [targetBankKey];
            if (questionIndex != null && Number.isInteger(questionIndex) && questionIndex >= 0) {
                initialMode = 'single';
                currentQuestionIndex = questionIndex;
            } else {
                initialMode = options?.mode || 'unit';
            }
        }

        if (subjectEl) subjectEl.textContent = currentSubject;
        if (titleEl) {
            titleEl.textContent = initialMode === 'bank' || !targetBankKey
                ? `編輯題目內容 - ${currentSubject}`
                : `編輯題目內容 - ${parseBankLabel(targetBankKey).title}`;
        }

        currentMode = initialMode;
        if (currentMode === 'bank') {
            tabBank?.classList.add('active'); tabBank?.setAttribute('aria-selected', 'true');
            tabAll?.classList.remove('active'); tabAll?.setAttribute('aria-selected', 'false');
            tabSingle?.classList.remove('active'); tabSingle?.setAttribute('aria-selected', 'false');
        } else if (currentMode === 'single') {
            tabBank?.classList.remove('active'); tabBank?.setAttribute('aria-selected', 'false');
            tabAll?.classList.remove('active'); tabAll?.setAttribute('aria-selected', 'false');
            tabSingle?.classList.add('active'); tabSingle?.setAttribute('aria-selected', 'true');
        } else {
            tabBank?.classList.remove('active'); tabBank?.setAttribute('aria-selected', 'false');
            tabAll?.classList.add('active'); tabAll?.setAttribute('aria-selected', 'true');
            tabSingle?.classList.remove('active'); tabSingle?.setAttribute('aria-selected', 'false');
        }

        try {
            if (bankKeysToLoad.length === 1 && readCatalog) {
                try {
                    const catalog = await readCatalog();
                    if (catalog) {
                        const isArch = targetBankKey.startsWith('_Archive_');
                        const sisterKeys = Object.keys(catalog).filter(k =>
                            k.startsWith('_Archive_') === isArch &&
                            parseBankLabel(k).subject === currentSubject
                        );
                        if (sisterKeys.length > 1) {
                            bankKeysToLoad = sisterKeys;
                        }
                    }
                } catch {}
            }

            let loadedBanks;
            try {
                loadedBanks = await Promise.all(bankKeysToLoad.map(async key => {
                    const list = await readBank(key);
                    return {
                        title: key,
                        questions: Array.isArray(list) ? list.map(q => ({ ...q })) : []
                    };
                }));
            } catch (err) {
                if (targetBankKey && bankKeysToLoad.length > 1) {
                    const list = await readBank(targetBankKey);
                    loadedBanks = [{
                        title: targetBankKey,
                        questions: Array.isArray(list) ? list.map(q => ({ ...q })) : []
                    }];
                } else {
                    throw err;
                }
            }

            currentBanks = loadedBanks && loadedBanks.length > 0 ? loadedBanks : [{ title: targetBankKey || currentSubject, questions: [] }];
            originalBankKeys = currentBanks.map(b => b.title);

            let targetIdx = currentBanks.findIndex(b => b.title === targetBankKey);
            currentBankIndex = targetIdx >= 0 ? targetIdx : 0;

            if (initialMode === 'single') {
                currentMode = 'single';
                currentQuestionIndex = (questionIndex != null && Number.isInteger(questionIndex)) ? questionIndex : 0;
            } else if (initialMode === 'bank') {
                currentMode = 'bank';
                currentQuestionIndex = 0;
            } else {
                currentMode = 'unit';
                currentQuestionIndex = 0;
            }

            if (textarea) textarea.disabled = false;
            if (saveBtn) saveBtn.disabled = false;
            syncTextarea();
        } catch (e) {
            if (textarea) textarea.value = '';
            showError(e.message || '載入題目失敗。');
        }
    }

    tabBank?.addEventListener('click', () => switchMode('bank'));
    tabAll?.addEventListener('click', () => switchMode('unit'));
    tabSingle?.addEventListener('click', () => switchMode('single'));

    unitSelect?.addEventListener('change', () => {
        const nextIdx = parseInt(unitSelect.value, 10);
        if (Number.isNaN(nextIdx) || nextIdx === currentBankIndex) return;
        try {
            commitTextareaChanges();
            showError('');
        } catch (e) {
            showError(`切換單元時目前編輯內容格式不正確：${e.message}`);
            unitSelect.value = String(currentBankIndex);
            return;
        }
        currentBankIndex = nextIdx;
        currentQuestionIndex = 0;
        syncTextarea();
    });

    questionSelect?.addEventListener('change', () => {
        const nextIdx = parseInt(questionSelect.value, 10);
        if (Number.isNaN(nextIdx) || nextIdx === currentQuestionIndex) return;
        try {
            commitTextareaChanges();
            showError('');
        } catch (e) {
            showError(`切換題目時目前編輯內容格式不正確：${e.message}`);
            questionSelect.value = String(currentQuestionIndex);
            return;
        }
        currentQuestionIndex = nextIdx;
        syncTextarea();
    });

    formatBtn?.addEventListener('click', () => {
        try {
            const parsed = validateQuestionPayload(textarea.value, currentMode);
            textarea.value = formatQuestionJson(parsed);
            showError('');
        } catch (e) {
            showError(e.message);
        }
    });

    copyBtn?.addEventListener('click', async () => {
        const orig = copyBtn.textContent;
        try {
            await navigator.clipboard.writeText(textarea.value);
            copyBtn.textContent = '已複製！';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch {
            textarea.select();
            document.execCommand('copy');
            copyBtn.textContent = '已複製！';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        }
    });

    saveBtn?.addEventListener('click', async () => {
        if (isSaving || !currentBanks.length) return;
        showError('');
        showStatus('');
        try {
            commitTextareaChanges();
        } catch (e) {
            showError(e.message);
            return;
        }

        const changes = {};
        if (currentMode === 'bank') {
            const newTitles = new Set(currentBanks.map(b => b.title));
            for (const oldKey of originalBankKeys) {
                if (!newTitles.has(oldKey)) {
                    changes[oldKey] = null;
                }
            }
            for (const b of currentBanks) {
                changes[b.title] = b.questions;
            }
        } else {
            const curBank = currentBanks[currentBankIndex];
            changes[curBank.title] = curBank.questions;
        }

        isSaving = true;
        saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        showStatus('正在儲存題庫至伺服器…');

        try {
            await writeBanks(changes);
            showStatus('儲存成功！');
            await onChanged?.(changes);
            setTimeout(() => {
                isSaving = false;
                saveBtn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
                close();
            }, 600);
        } catch (cause) {
            isSaving = false;
            saveBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
            showStatus('');
            showError(/permission/i.test(`${cause.code || ''} ${cause.message}`)
                ? '權限不足，無法修改題庫題目。' : cause.message || '儲存失敗，請重試。');
        }
    });

    closeBtn?.addEventListener('click', close);
    cancelBtn?.addEventListener('click', close);
    modal.addEventListener('click', e => {
        if (e.target === modal) close();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.style.display !== 'none') {
            close();
        }
    });

    return {
        open,
        close
    };
}
