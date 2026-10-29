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

export function mountContentEditor({ readBank, writeBanks, onChanged, getUser }) {
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
    const tabAll = $('bankEditScopeAll');
    const tabSingle = $('bankEditScopeSingle');
    const pickerWrap = $('bankEditQuestionPickerWrap');
    const questionSelect = $('bankEditQuestionSelect');
    const textarea = $('bankContentEditTextarea');
    const metaInfo = $('bankEditMetaInfo');
    const errorEl = $('bankContentEditError');
    const statusEl = $('bankContentEditStatus');

    let currentBankKey = null;
    let currentQuestions = [];
    let currentMode = 'unit'; // 'unit' | 'single'
    let currentQuestionIndex = 0;
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

    function updateQuestionPicker() {
        if (!questionSelect) return;
        questionSelect.replaceChildren();
        currentQuestions.forEach((q, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            const snippet = (q.question || '').replace(/\s+/g, ' ').slice(0, 32);
            opt.textContent = `第 ${i + 1} 題：${snippet || '(無題幹)'}`;
            questionSelect.append(opt);
        });
        questionSelect.value = String(currentQuestionIndex);
    }

    function syncTextarea() {
        if (currentMode === 'unit') {
            textarea.value = formatQuestionJson(currentQuestions);
            if (metaInfo) metaInfo.textContent = `共 ${currentQuestions.length} 題`;
            tabAll?.classList.add('active');
            tabAll?.setAttribute('aria-selected', 'true');
            tabSingle?.classList.remove('active');
            tabSingle?.setAttribute('aria-selected', 'false');
            if (pickerWrap) pickerWrap.hidden = true;
        } else {
            const q = currentQuestions[currentQuestionIndex] || {};
            textarea.value = formatQuestionJson(q);
            if (metaInfo) metaInfo.textContent = `第 ${currentQuestionIndex + 1} / ${currentQuestions.length} 題`;
            tabSingle?.classList.add('active');
            tabSingle?.setAttribute('aria-selected', 'true');
            tabAll?.classList.remove('active');
            tabAll?.setAttribute('aria-selected', 'false');
            if (pickerWrap) pickerWrap.hidden = false;
            updateQuestionPicker();
        }
    }

    function close() {
        if (isSaving) return;
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        showError('');
        showStatus('');
        currentBankKey = null;
        currentQuestions = [];
    }

    async function open(bankKey, questionIndex = null) {
        const uid = getUser?.();
        if (!uid) {
            alert('請先登入後再編輯題庫。');
            return;
        }
        currentBankKey = bankKey;
        const label = parseBankLabel(bankKey);
        if (subjectEl) subjectEl.textContent = label.subject;
        if (titleEl) titleEl.textContent = `編輯題目內容 - ${label.title}`;
        showError('');
        showStatus('');
        if (textarea) {
            textarea.value = '載入題目中…';
            textarea.disabled = true;
        }
        if (saveBtn) saveBtn.disabled = true;
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        try {
            const list = await readBank(bankKey);
            currentQuestions = Array.isArray(list) ? list.map(q => ({ ...q })) : [];
            if (textarea) textarea.disabled = false;
            if (saveBtn) saveBtn.disabled = false;

            if (questionIndex != null && Number.isInteger(questionIndex) && questionIndex >= 0 && questionIndex < currentQuestions.length) {
                currentMode = 'single';
                currentQuestionIndex = questionIndex;
            } else {
                currentMode = 'unit';
                currentQuestionIndex = 0;
            }
            syncTextarea();
        } catch (e) {
            if (textarea) textarea.value = '';
            showError(e.message || '載入題目失敗。');
        }
    }

    // Switch to 'unit' mode
    tabAll?.addEventListener('click', () => {
        if (currentMode === 'unit') return;
        try {
            const parsed = validateQuestionPayload(textarea.value, 'single');
            currentQuestions = mergeQuestionEdit(currentQuestions, parsed, currentQuestionIndex);
            showError('');
        } catch (e) {
            showError(`切換模式前請先確認目前題目 JSON 格式正確：${e.message}`);
            return;
        }
        currentMode = 'unit';
        syncTextarea();
    });

    // Switch to 'single' mode
    tabSingle?.addEventListener('click', () => {
        if (currentMode === 'single') return;
        try {
            const parsed = validateQuestionPayload(textarea.value, 'unit');
            currentQuestions = parsed;
            showError('');
        } catch (e) {
            showError(`切換模式前請先確認整個單元 JSON 格式正確：${e.message}`);
            return;
        }
        currentMode = 'single';
        if (currentQuestionIndex >= currentQuestions.length) currentQuestionIndex = 0;
        syncTextarea();
    });

    // Select different question in 'single' mode
    questionSelect?.addEventListener('change', () => {
        const nextIdx = parseInt(questionSelect.value, 10);
        if (Number.isNaN(nextIdx) || nextIdx === currentQuestionIndex) return;
        try {
            const parsed = validateQuestionPayload(textarea.value, 'single');
            currentQuestions = mergeQuestionEdit(currentQuestions, parsed, currentQuestionIndex);
            showError('');
        } catch (e) {
            showError(`切換題目時目前編輯內容格式不正確：${e.message}`);
            questionSelect.value = String(currentQuestionIndex);
            return;
        }
        currentQuestionIndex = nextIdx;
        syncTextarea();
    });

    // Format JSON
    formatBtn?.addEventListener('click', () => {
        try {
            const parsed = validateQuestionPayload(textarea.value, currentMode);
            textarea.value = formatQuestionJson(parsed);
            showError('');
        } catch (e) {
            showError(e.message);
        }
    });

    // Copy JSON to clipboard
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

    // Save
    saveBtn?.addEventListener('click', async () => {
        if (isSaving || !currentBankKey) return;
        showError('');
        showStatus('');
        let finalQuestions;
        try {
            if (currentMode === 'unit') {
                finalQuestions = validateQuestionPayload(textarea.value, 'unit');
            } else {
                const parsed = validateQuestionPayload(textarea.value, 'single');
                finalQuestions = mergeQuestionEdit(currentQuestions, parsed, currentQuestionIndex);
            }
        } catch (e) {
            showError(e.message);
            return;
        }

        isSaving = true;
        saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        showStatus('正在儲存題庫至伺服器…');

        try {
            await writeBanks({ [currentBankKey]: finalQuestions });
            showStatus('儲存成功！');
            await onChanged?.({ [currentBankKey]: finalQuestions });
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
