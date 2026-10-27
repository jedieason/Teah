import { createCollection } from './features/collections/view.js';
import { mountQuestionSearch } from './features/search/view.js';
import { mountBankLibrary } from './features/library/view.js';
import { mountSidebar } from './shared/sidebar.js';
import { mountFlashcard } from './features/flashcard/view.js';
import { mountEditorial } from './features/learning/editorial.js';
import { normalizeQuestion } from './features/learning/model.js';
import { loadLearning, recordLearning, readBank } from './services/learning.js';
import { enqueue, flushOutbox, storage } from './services/outbox.js';
import { mountLearningHub } from './features/learning/hub.js';
import { mountReviewFlashcards } from './features/flashcard/review-flashcards.js';
import { installDialogBehavior } from './shared/dialogs.js';
import { readCatalog, writeBanks, validBankName, bankExists } from './services/catalog.js';
import { database, auth, googleProvider, GoogleAuthProvider, ref, get, update, set, remove, runTransaction, signInWithPopup, signInWithRedirect, getRedirectResult, signInWithCredential, onAuthStateChanged, signOut } from './services/firebase.js';
import { flattenMistakes, canonicalQuestion, applyAttempt, preparePractice, quizLabel } from './features/mistakes/model.js';
import { createNotebook } from './features/mistakes/notebook.js';
import { markdown, getOrderedOptionEntries, normalizeQuestionOptions } from './shared/content.js';
import { streamGemini } from './services/gemini-stream.js';
import { gradeShortAnswer, getScoreTier } from './services/ai-grader.js';
import { findSubsequentQuizzes, getPastExamComparisonInfo } from './services/exam-dedup.js';
import { buildCategorizedPrompt, buildMultiUnitPrompt, buildSingleUnitPrompt, parseCustomUnits } from './shared/contribute-prompts.js';
import { parseQuizImport, buildImportChanges } from './shared/quiz-import.js';
import { diagnoseJson, autoRepairJson, mergeContinuation, locateJsonPath, buildJsonRepairPrompt, stripMarkdownFences } from './shared/json-diagnostics.js';
import { mountJsonErrorEditor } from './shared/json-editor.js';
import { isIosStandalone, isInAppBrowser, formatSignInErrorMessage, parseAuthHash, buildGoogleAuthUrl, getCanonicalRedirectUri } from './services/auth-helper.js';
import { buildQuizRecord, downloadQuizRecord } from './shared/quiz-record.js';
const signInBtn = document.getElementById('signInBtn');
const errataModal = document.getElementById('errataModal');
const errataFormContainer = document.getElementById('errataFormContainer');
// Restore preview elements
const restoreBtn = document.getElementById('restore');
if (restoreBtn) restoreBtn.style.display = 'none';

async function updateRestorePreview(user) {
    const continueSection = document.getElementById('continue-section');
    const titleText = document.getElementById('continue-title-text');
    const statsText = document.getElementById('continue-stats-text');
    const progressFill = document.getElementById('continue-progress-fill');
    const continueBtn = document.getElementById('continue-btn-action');

    const hideSection = () => { if (continueSection) continueSection.style.display = 'none'; };

    try {
        if (!user) { hideSection(); return; }

        const lastActiveSnap = await get(ref(database, `progress/${user.uid}/lastActive`));
        let activeQuizName = null;
        let resolvedSelectedJson = null;

        if (lastActiveSnap.exists()) {
            const lastActive = lastActiveSnap.val();
            activeQuizName = lastActive.quizName;
            resolvedSelectedJson = lastActive.selectedJson;
        } else {
            // Find latest in cache
            const keys = Object.keys(userProgressCache);
            if (keys.length === 0) { hideSection(); return; }
            let maxTime = 0;
            for (const key of keys) {
                const p = userProgressCache[key];
                if (p.lastUpdated && p.lastUpdated > maxTime) {
                    maxTime = p.lastUpdated;
                    activeQuizName = key;
                    resolvedSelectedJson = p.selectedJson;
                }
            }
        }

        if (!activeQuizName) { hideSection(); return; }

        const p = userProgressCache[activeQuizName];
        if (!p) { hideSection(); return; }

        const fileName = (p.sessionKind === 'custom' ? '自訂測驗' : p.selectedJson || '').split('/').pop().replace('.json', '') || '最近的中斷點';

        let total = 0;
        let done = 0;
        if (p.allQuestions) {
            total = p.allQuestions.length;
            done = p.allQuestions.filter(q => q.isAnswered).length;
        } else {
            total = (p.questions?.length || 0) + (p.correct || 0) + (p.wrong || 0);
            done = (p.correct || 0) + (p.wrong || 0);
        }

        const percent = total > 0 ? Math.round(done / total * 100) : 0;

        if (percent >= 100 || (percent <= 0 && done === 0)) { hideSection(); return; }

        if (continueSection) continueSection.style.display = 'block';
        if (titleText) titleText.textContent = fileName;
        if (statsText) statsText.textContent = `進度：${done}/${total}`;
        if (progressFill) progressFill.style.width = `${percent}%`;

        if (continueBtn) {
            continueBtn.onclick = () => {
                restoreProgress(activeQuizName);
            };
        }
    } catch (e) {
        console.error(e);
        hideSection();
    }
}

let sessionId = crypto.randomUUID();
let sessionMode = 'study';
let sessionKind = 'bank';
let sessionTimeLimit = 15;
let activeShuffleOptions = false;
let customSession = null;
let questionStartedAt = Date.now();
let questions = [];
let allQuestions = [];
let currentIndex = 0;
let viewingIndex = 0;
let initialQuestionCount = 0;
let currentQuestion = {};
let acceptingAnswers = true;
let selectedOption = null; // 單選題使用
let selectedOptions = [];  // 多選題使用
let correct = 0;
let wrong = 0;
let selectedJson = null; // 初始為 null
let userProgressCache = {};
let learningDataReady = false;
let userMistakesCache = {};
let catalogPaths = [];
let catalogData = {};
let catalogRequest = 0;

// 獲取唯一的錯題與收藏存儲鍵名（包含科目與習題名稱）
function getQuizStorageName(path) {
    if (!path) return 'default';
    if (catalogData[path]?.storageKey) return catalogData[path].storageKey;

    let cleanPath = path;
    if (cleanPath.startsWith('_Archive_')) {
        cleanPath = cleanPath.substring(9);
    }
    cleanPath = cleanPath.replace('.json', '');

    // 如果路徑已經包含 '|' 或 '｜'，表示已經有科目名稱
    if (cleanPath.includes('｜') || cleanPath.includes('|')) {
        // Continue to sanitization below
    } else if (cleanPath.includes('/')) {
        // 如果包含 '/'，表示可能是一個帶目錄的路徑，如 "數學/B10期末考第52題.json"
        const parts = cleanPath.split('/').filter(Boolean);
        if (parts.length >= 2) {
            const subject = parts[parts.length - 2];
            const title = parts[parts.length - 1];
            cleanPath = `${subject}｜${title}`;
        } else if (parts.length === 1) {
            cleanPath = parts[0];
        }
    }

    // Firebase Database keys must not contain '.', '#', '$', '[', ']', or '/'
    return cleanPath.replace(/[.$#[\]/]/g, '_');
}
// Fill-in-the-blank elements
const fillblankContainer = document.querySelector('.fillblank-container');
const fillblankInput = document.getElementById('fillblank-input');
let isTestCompleted = false; // Flag to track test completion

// Quiz container reference for restoring UI on redo
const quizContainer = document.querySelector('.quiz-container');
const originalQuizDisplay = quizContainer.style.display || 'flex';
let endScreenDiv = null;

// 新增：洗牌偏好設定
let shouldShuffleQuiz = localStorage.getItem('shuffleQuiz') === 'true'; // false: 固定順序 (JSON 順序), true: 隨機順序

// 新增：歷史紀錄陣列
let questionHistory = [];
let wrongQuestions = [];
let isMistakePracticeMode = false;



const userQuestionInput = document.getElementById('userQuestion');
let timerFrameId = null;
const timerDisplay = document.getElementById('quizTimer');
let expandTimeout;

window.MathJax = {
    tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']]
    },
    svg: {
        fontCache: 'global'
    }
};

// 初始化測驗
async function initQuiz() {
    libraryLocations[libraryPage].scroll = window.scrollY;
    if (['library', 'archive'].includes(libraryPage)) libraryLocations[libraryPage].query = document.getElementById('bankSearch').value;
    sessionId = crypto.randomUUID();
    const isSkipRepeatMode = !!customSession?.isSkipRepeatMode;
    activeShuffleOptions = customSession ? customSession.shuffleOptions : shouldShuffleQuiz;
    sessionTimeLimit = customSession?.timeLimit ?? 15;
    sessionKind = customSession ? 'custom' : 'bank';
    sessionMode = customSession?.mode || 'study';
    document.body.classList.toggle('exam-active', sessionMode === 'exam');
    isMistakePracticeMode = false;
    isTestCompleted = false;

    await loadQuestions();

    // Process and shuffle allQuestions
    allQuestions = JSON.parse(JSON.stringify(questions));
    allQuestions.forEach((q, idx) => {
        q.originalIndex = q.originalIndex ?? idx;
    });
    if (sessionKind !== 'custom' && shouldShuffleQuiz) {
        shuffle(allQuestions);
    }

    allQuestions.forEach(q => {
        // Normalize single-element array answer to string
        if (Array.isArray(q.answer) && q.answer.length === 1) {
            q.answer = q.answer[0];
        }

        // Determine fill blank
        if (!q.options) {
            q.isFillBlank = true;
            q.isMultiSelect = false;
        } else {
            q.isFillBlank = false;
            q.isMultiSelect = Array.isArray(q.answer) && q.answer.length > 1;
        }

        // Shuffle options and map to standard letters if it's multiple choice
        if (!q.isFillBlank) {
            const optionKeys = Object.keys(q.options);
            let optionLabels = [];
            let shouldShuffleOptionContent = true;
            if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
                optionLabels = ['T', 'F'];
                shouldShuffleOptionContent = false;
            } else {
                optionLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
                shouldShuffleOptionContent = activeShuffleOptions;
            }

            let optionEntries = Object.entries(q.options);
            if (shouldShuffleOptionContent) {
                shuffle(optionEntries);
            } else if (optionLabels.length === 2 && optionLabels[0] === 'T' && optionLabels[1] === 'F') {
                optionEntries.sort((a, b) => {
                    const order = { 'T': 0, 'F': 1 };
                    return order[a[0]] - order[b[0]];
                });
            }

            let labelMapping = {};
            q.reverseLabelMapping = {};
            for (let i = 0; i < optionEntries.length; i++) {
                const [originalLabel, _] = optionEntries[i];
                labelMapping[originalLabel] = optionLabels[i];
                q.reverseLabelMapping[optionLabels[i]] = originalLabel;
            }

            let newOptions = {};
            let newAnswer = q.isMultiSelect ? [] : '';
            for (let i = 0; i < optionEntries.length; i++) {
                const [label, text] = optionEntries[i];
                const newLabel = optionLabels[i];
                newOptions[newLabel] = text;

                if (q.isMultiSelect) {
                    if (Array.isArray(q.answer) && q.answer.includes(label)) {
                        newAnswer.push(newLabel);
                    }
                } else {
                    if (label === q.answer) {
                        newAnswer = newLabel;
                    }
                }
            }

            q.options = normalizeQuestionOptions(newOptions);
            q.answer = newAnswer;
            q.explanation = updateExplanationOptions(q.explanation, labelMapping);
        }

        q.isAnswered = false;
        q.isCorrect = null;
        q.userSelection = null;
        q.isConfirmed = false;
    });

    initialQuestionCount = allQuestions.length;
    currentIndex = 0;
    viewingIndex = 0;
    correct = 0;
    wrong = 0;
    selectedOption = null;
    selectedOptions = [];
    document.getElementById('correct').innerText = 0;
    document.getElementById('wrong').innerText = 0;

    document.querySelector('.start-screen').style.display = 'none';
    document.querySelector('.quiz-container').style.display = 'flex';

    // Update the quiz title with the current file name
    const fileName = selectedJson.split('/').pop().replace('.json', '');
    const titleText = isSkipRepeatMode ? `${fileName} · 非考古題` : `${fileName}`;
    document.querySelector('.quiz-title').innerText = `${titleText}`;
    document.title = `${titleText} - 題矣`;

    createProgressDots();
    renderQuestion(currentIndex);
    saveProgress();
}

// 加載題目 (Firebase)
async function loadQuestions() {
    questions = [];
    questions = customSession?.questions || await readBank(selectedJson);
    customSession = null;
}

// 洗牌函數
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function loadNewQuestion() {
    currentIndex++;
    selectedOption = null;
    selectedOptions = [];
    if (currentIndex >= allQuestions.length) {
        stopTimer();
        showEndScreen();
        return;
    }
    viewingIndex = currentIndex;
    renderQuestion(currentIndex);
    saveProgress();
}

function createProgressDots() {
    const container = document.getElementById('progressDots');
    if (!container) return;
    container.innerHTML = '';

    allQuestions.forEach((_, i) => {
        const dot = document.createElement('div');
        dot.className = 'progress-dot';
        dot.setAttribute('data-tooltip', `第 ${i + 1} 題`);

        dot.innerHTML = `
            <svg viewBox="0 0 18 18" width="18" height="18" class="progress-dot-svg">
                <circle cx="9" cy="9" r="4" class="dot-fill" />
                <circle cx="9" cy="9" r="5.5" stroke-width="1" fill="none" class="dot-stroke" />
            </svg>
        `;

        dot.addEventListener('click', () => {
            renderQuestion(i);
        });
        container.appendChild(dot);
    });
    updateDotsUI();
}

function updateDotsUI() {
    const container = document.getElementById('progressDots');
    if (!container) return;
    const dots = container.querySelectorAll('.progress-dot');

    dots.forEach((dot, i) => {
        const q = allQuestions[i];
        dot.classList.remove('correct', 'wrong', 'current-progress', 'viewing');

        if (q.isAnswered && (sessionMode !== 'exam' || isTestCompleted)) {
            if (q.isCorrect) {
                dot.classList.add('correct');
            } else {
                dot.classList.add('wrong');
            }
        }

        if (i === currentIndex) {
            dot.classList.add('current-progress');
        }

        if (i === viewingIndex) {
            dot.classList.add('viewing');
        }
    });
}

function renderQuestion(index) {
    viewingIndex = index;
    const q = allQuestions[index];
    if (!q) return;
    const revealAnswer = sessionMode !== 'exam' || isTestCompleted;
    document.getElementById('next-btn').textContent = sessionMode === 'exam' && index === allQuestions.length - 1 ? '交卷' : '下一題';

    if (currentQuestion !== q) {
        questionStartedAt = Date.now();
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
    }
    currentQuestion = q; // Update currentQuestion globally

    const confirmBtn = document.getElementById('confirm-btn');
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-progress-btn');
    const backBtnExpl = document.getElementById('back-progress-btn-expl');

    document.getElementById('WeeGPTInputSection').style.display = 'none';
    updateStarIcon();

    const questionDiv = document.getElementById('question');
    const questionHtml = markdown(q.question);
    if (q.isFillBlank) {
        questionDiv.innerHTML = `
            <div class="question-wrapper">
                <div class="multi-label">簡</div>
                <div class="question-text">${questionHtml}</div>
            </div>
        `;
    } else if (q.isMultiSelect) {
        questionDiv.innerHTML = `
            <div class="question-wrapper">
                <div class="multi-label">多</div>
                <div class="question-text">${questionHtml}</div>
            </div>
        `;
    } else {
        questionDiv.innerHTML = `<div class="question-text">${questionHtml}</div>`;
    }
    renderLatex(questionDiv);

    const optionsContainer = document.getElementById('options');
    if (q.isFillBlank) {
        optionsContainer.style.display = 'none';
        fillblankContainer.style.display = 'flex';
        fillblankInput.value = q.userSelection || '';
        fillblankInput.className = 'fillblank-input';
        fillblankInput.disabled = true;

        if (q.isConfirmed && revealAnswer) {
            if (q.aiGrade && !q.aiGrade.error) {
                const tier = getScoreTier(q.aiGrade.score);
                fillblankInput.classList.add(tier.className);
            }
            if (q.isCorrect) {
                fillblankInput.classList.add('correct');
            } else {
                fillblankInput.classList.add('incorrect');
            }
        } else if (index === currentIndex && !q.aiGradeLoading) {
            fillblankInput.disabled = false;
        }
    } else {
        optionsContainer.style.display = 'flex';
        fillblankContainer.style.display = 'none';
        optionsContainer.innerHTML = '';

        if (q.options) q.options = normalizeQuestionOptions(q.options);

        getOrderedOptionEntries(q.options).forEach(([key, value]) => {
            const button = document.createElement('button');
            button.classList.add('option-button');
            button.dataset.option = key;
            button.innerHTML = markdown(`${key}: ${value}`);
            renderLatex(button);

            if (q.isConfirmed && revealAnswer) {
                if (q.isMultiSelect) {
                    const userSel = q.userSelection || [];
                    if (userSel.includes(key)) {
                        button.classList.add('selected');
                    }
                    if (Array.isArray(q.answer) && q.answer.includes(key)) {
                        if (userSel.includes(key)) {
                            button.classList.add('correct');
                        } else {
                            button.classList.add('missing');
                        }
                    } else if (userSel.includes(key)) {
                        button.classList.add('incorrect');
                    }
                } else {
                    if (q.userSelection === key) {
                        button.classList.add('selected');
                    }
                    if (key === q.answer) {
                        button.classList.add('correct');
                    } else if (q.userSelection === key) {
                        button.classList.add('incorrect');
                    }
                }
            } else {
                if (index === currentIndex) {
                    button.addEventListener('click', selectOption);
                    if (q.isMultiSelect) {
                        if (selectedOptions.includes(key)) {
                            button.classList.add('selected');
                        }
                    } else {
                        if (selectedOption === key) {
                            button.classList.add('selected');
                        }
                    }
                }
            }
            optionsContainer.appendChild(button);
        });
    }

    const explanationEl = document.getElementById('explanation');
    const originDisplay = document.getElementById('origin-display');
    if (q.isConfirmed) {
        if (revealAnswer) {
            renderChatDisplay(q);
        } else {
            document.getElementById('explanation-text').innerHTML = '';
        }
        explanationEl.style.display = 'block';
        if (q.origin) {
            originDisplay.textContent = q.origin;
            originDisplay.style.display = 'block';
        } else {
            originDisplay.style.display = 'none';
        }
    } else {
        explanationEl.style.display = 'none';
        originDisplay.style.display = 'none';
    }

    if (index === currentIndex) {
        backBtn.style.display = 'none';
        backBtnExpl.style.display = 'none';
        acceptingAnswers = !q.isConfirmed;

        if (q.isConfirmed) {
            confirmBtn.style.display = 'none';
            nextBtn.style.display = 'block';
            stopTimer();
        } else {
            confirmBtn.style.display = 'block';
            confirmBtn.disabled = false;
            nextBtn.style.display = 'none';
            startTimer();
        }
    } else {
        backBtn.style.display = q.isConfirmed ? 'none' : 'block';
        backBtnExpl.style.display = q.isConfirmed ? 'block' : 'none';
        confirmBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        acceptingAnswers = false;
        stopTimer();
    }

    updateDotsUI();
}

function updateExplanationOptions(explanation, labelMapping) {
    if (!explanation) {
        return '尚無詳解';
    }
    // Regex to match (A), ( B ), （Ｃ）, （ D ）, (Ｅ), （F）, etc.
    // It allows for optional spaces between the parentheses (half-width or full-width)
    // and the letter (half-width or full-width A-L).
    return explanation.replace(/(?:\(|\uFF08)\s*([A-L\uFF21-\uFF2C])\s*(?:\)|\uFF09)/g, function (match, capturedLetter) {
        let standardLabel = capturedLetter;
        // Convert full-width letter to half-width if necessary
        const charCode = capturedLetter.charCodeAt(0);
        if (charCode >= 0xFF21 && charCode <= 0xFF2C) { // Check if it's a full-width Latin capital letter A-L
            standardLabel = String.fromCharCode(charCode - 0xFEE0); // Convert to half-width
        }
        // Now standardLabel is guaranteed to be a half-width character like 'A', 'B', etc.
        let newLabel = labelMapping[standardLabel] || standardLabel; // Use the standardized (half-width) label for lookup
        return `(${newLabel})`; // Always return with half-width parentheses for consistency in the output
    });
}

// 選擇選項
function selectOption(event) {
    if (currentQuestion.userSelection || selectedOption || selectedOptions.length) currentQuestion.changedAnswer = true;
    if (!acceptingAnswers) return;
    const btn = event.currentTarget;
    const option = btn.dataset.option;
    if (currentQuestion.isMultiSelect) {
        // 多選題：切換選取狀態，不會清除其他選項
        if (selectedOptions.includes(option)) {
            selectedOptions = selectedOptions.filter(o => o !== option);
            btn.classList.remove('selected');
        } else {
            selectedOptions.push(option);
            btn.classList.add('selected');
        }
    } else {
        // 單選題：只允許一個選項被選
        document.querySelectorAll('.option-button').forEach(btn => {
            btn.classList.remove('selected');
        });
        btn.classList.add('selected');
        selectedOption = option;
    }
}

// 取得模態窗口和確認按鈕元素
const customAlert = document.getElementById('customAlert');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalMessage = document.getElementById('modal-message');
let customAlertConfirmCallback = null;

function setModalMessage(message) {
    modalMessage.innerText = message;
}

let alertTimeout = null;

function showCustomAlert(message, arg2) {
    setModalMessage(message);

    // Reset classes (keep base class 'notification-bar')
    customAlert.className = 'notification-bar';

    let onConfirm = null;
    if (typeof arg2 === 'function') {
        onConfirm = arg2;
    } else if (typeof arg2 === 'string') {
        customAlert.classList.add(arg2);
    }

    customAlert.classList.add('show');
    customAlertConfirmCallback = onConfirm;

    // Clear any existing timeout (in case an alert is already shown)
    if (alertTimeout) {
        clearTimeout(alertTimeout);
    }

    // Auto-hide after 5 seconds
    alertTimeout = setTimeout(() => {
        hideCustomAlert();
    }, 5000);
}

function hideCustomAlert() {
    customAlert.classList.remove('show');
    if (alertTimeout) {
        clearTimeout(alertTimeout);
        alertTimeout = null;
    }
}

modalConfirmBtn.addEventListener('click', () => {
    hideCustomAlert();
    if (typeof customAlertConfirmCallback === 'function') {
        const cb = customAlertConfirmCallback;
        customAlertConfirmCallback = null;
        try { cb(); } catch (e) { console.error(e); }
    }
});

let isGradingAnswer = false;

async function retryGrading(q) {
    if (!q || isGradingAnswer) return;
    isGradingAnswer = true;
    q.aiGradeLoading = true;
    renderChatDisplay(q);

    let fallbackKey = '';
    try {
        const keySnap = await get(ref(database, 'API_KEY'));
        fallbackKey = typeof keySnap.val() === 'string' ? keySnap.val().trim() : '';
    } catch {}

    const prevCorrect = q.isCorrect;
    try {
        const gradeResult = await gradeShortAnswer({
            question: q.question,
            answer: q.answer,
            explanation: q.explanation,
            response: q.userSelection,
            apiKey: fallbackKey,
        });
        q.aiGrade = gradeResult;
        q.aiGradeLoading = false;
        q.isCorrect = gradeResult.score >= 6;

        if (prevCorrect !== q.isCorrect) {
            if (q.isCorrect) {
                correct += 1;
                wrong = Math.max(0, wrong - 1);
            } else {
                wrong += 1;
                correct = Math.max(0, correct - 1);
            }
            document.getElementById('correct').innerText = correct;
            document.getElementById('wrong').innerText = wrong;
        }
    } catch (err) {
        console.error('Retry AI grading failed', err);
        q.aiGradeLoading = false;
        q.aiGrade = {
            error: true,
            message: 'AI 評分連線中斷或服務未就緒。',
        };
    } finally {
        isGradingAnswer = false;
        q.aiGradeLoading = false;
        renderQuestion(currentIndex);
        saveProgress();
    }
}

async function confirmAnswer() {
    const active = allQuestions[currentIndex];
    if (active && !active.isAnswered) active.responseTimeMs = Math.max(0, Date.now() - questionStartedAt);
    const q = allQuestions[currentIndex];
    if (!q || q.isAnswered || viewingIndex !== currentIndex || isGradingAnswer) return;

    if (q.isFillBlank) {
        const userInput = fillblankInput.value.trim();
        if (!userInput) {
            showCustomAlert('請輸入您的答案！');
            return;
        }
        stopTimer();

        q.userSelection = userInput;
        q.isAnswered = true;
        q.aiGradeLoading = true;
        isGradingAnswer = true;

        const confirmBtn = document.getElementById('confirm-btn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '評分中…';
        }
        fillblankInput.disabled = true;

        const reveal = sessionMode !== 'exam' || isTestCompleted;
        if (reveal) {
            const explanationEl = document.getElementById('explanation');
            if (explanationEl) explanationEl.style.display = 'block';
            renderChatDisplay(q);
        }

        let fallbackKey = '';
        try {
            const keySnap = await get(ref(database, 'API_KEY'));
            fallbackKey = typeof keySnap.val() === 'string' ? keySnap.val().trim() : '';
        } catch {}

        try {
            const gradeResult = await gradeShortAnswer({
                question: q.question,
                answer: q.answer,
                explanation: q.explanation,
                response: userInput,
                apiKey: fallbackKey,
            });
            q.aiGrade = gradeResult;
            q.aiGradeLoading = false;
            q.isCorrect = gradeResult.score >= 6;
        } catch (err) {
            console.error('AI grading failed', err);
            q.aiGradeLoading = false;
            q.aiGrade = {
                error: true,
                message: 'AI 評分連線中斷或服務未就緒。',
            };
            const sentence = userInput.toLowerCase();
            const required = Array.isArray(q.answer) ? q.answer : [q.answer];
            q.isCorrect = required.length > 0 && required.every(kw => sentence.includes(String(kw).toLowerCase()));
        } finally {
            isGradingAnswer = false;
            q.aiGradeLoading = false;
            q.isConfirmed = true;
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '確認';
            }
        }

        if (q.isCorrect) {
            updateCorrect();
        } else {
            updateWrong();
        }

        renderQuestion(currentIndex);
        saveProgress();
        return;
    } else {
        if (q.isMultiSelect) {
            if (selectedOptions.length === 0) {
                showCustomAlert('請先選擇答案。');
                return;
            }
            stopTimer();

            let isCompletelyCorrect = (selectedOptions.length === q.answer.length) &&
                q.answer.every(opt => selectedOptions.includes(opt));

            q.isCorrect = isCompletelyCorrect;
            q.userSelection = [...selectedOptions];
            q.isAnswered = true;
            q.isConfirmed = true;

            if (isCompletelyCorrect) {
                updateCorrect();
            } else {
                updateWrong();
            }
        } else {
            if (!selectedOption) {
                showCustomAlert('請先選擇答案。');
                return;
            }
            stopTimer();

            const isCorrect = selectedOption === q.answer;
            q.isCorrect = isCorrect;
            q.userSelection = selectedOption;
            q.isAnswered = true;
            q.isConfirmed = true;

            if (isCorrect) {
                updateCorrect();
            } else {
                updateWrong();
            }
        }

        renderQuestion(currentIndex);
        saveProgress();
    }
}

function updateCorrect() {
    if (sessionMode === 'exam' && !isTestCompleted) return;
    recordAttempt(true);
    correct += 1;
    document.getElementById('correct').innerText = correct;
    updateProgressBar(true);
}

function updateWrong() {
    if (sessionMode === 'exam' && !isTestCompleted) return;
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
    updateProgressBar(false);
    recordAttempt(false);
}

function showEndScreen() {
    const wasCompleted = isTestCompleted;
    isTestCompleted = true;
    if (sessionMode === 'exam' && !wasCompleted) {
        for (const q of allQuestions) { if (!q.isAnswered) continue; currentQuestion = q; if (q.isCorrect) updateCorrect(); else updateWrong(); }
    }
    document.body.classList.remove('exam-active');

    // Save progress at completed state (currentIndex = allQuestions.length)
    if (auth.currentUser && selectedJson) {
        currentIndex = allQuestions.length;
        saveProgress();
    }

    quizContainer.style.display = 'none';

    endScreenDiv = document.createElement('div');
    endScreenDiv.className = 'end-screen-overlay';

    const container = document.createElement('div');
    container.className = 'results-container';

    const title = document.createElement('h1');
    title.className = 'results-title';
    title.textContent = isMistakePracticeMode ? '複習完成' : '測驗完成';
    container.appendChild(title);
    const subtitle = document.createElement('p');
    subtitle.className = 'results-subtitle';
    const sources = new Set(allQuestions.map(q => q.sourcePath || selectedJson));
    subtitle.textContent = isMistakePracticeMode
        ? `錯題複習 · ${sources.size} 份題庫`
        : (selectedJson || '').replace(/^_Archive_/, '').replace(/\.json$/, '');
    container.appendChild(subtitle);
    const totalQuestions = correct + wrong;
    const accuracy = totalQuestions ? Math.round(correct / totalQuestions * 100) : 0;
    const score = document.createElement('div');
    score.className = 'results-accuracy';
    score.innerHTML = `<strong>${accuracy}%</strong><span>正確率</span>`;
    container.appendChild(score);
    const track = document.createElement('div');
    track.className = 'results-score-track';
    track.setAttribute('aria-hidden', 'true');
    track.innerHTML = `<div style="width:${accuracy}%"></div>`;
    container.appendChild(track);
    const statsGrid = document.createElement('div');
    statsGrid.className = 'results-stats-grid';
    statsGrid.innerHTML = `
        <div class="results-stat"><strong>${totalQuestions}</strong><span>已作答</span></div>
        <div class="results-stat correct"><strong>${correct}</strong><span>答對</span></div>
        <div class="results-stat wrong"><strong>${wrong}</strong><span>答錯</span></div>`;
    container.appendChild(statsGrid);

    // Action Buttons
    const actionArea = document.createElement('div');
    actionArea.className = 'results-actions';

    // Redo Wrong Button
    const redoBtn = document.createElement('button');
    redoBtn.className = 'primary-button';
    redoBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
        </svg>
        <span>重做錯題</span>
    `;
    const wrongList = allQuestions.filter(q => q.isAnswered && !q.isCorrect);
    if (wrongList.length === 0) {
        redoBtn.hidden = true;
    }
    let reviewFlashcardsHandle = null;

    redoBtn.addEventListener('click', () => {
        reviewFlashcardsHandle?.abort();
        const wrongListToRedo = allQuestions.filter(q => q.isAnswered && !q.isCorrect);
        if (wrongListToRedo.length === 0) return;

        isMistakePracticeMode = true;
        sessionId = crypto.randomUUID(); sessionMode = 'study';
        document.body.classList.remove('exam-active');
        allQuestions = wrongListToRedo.map(q => {
            return {
                sourcePath: q.sourcePath || selectedJson,
                mistakeQuizKey: q.mistakeQuizKey || getQuizStorageName(q.sourcePath || selectedJson),
                mistakeRecordPath: q.mistakeRecordPath || null,
                questionId: q.questionId || null, revision: q.revision || 1, taxonomy: q.taxonomy || null,
                question: q.question,
                options: q.options,
                answer: q.answer,
                explanation: q.explanation,
                origin: q.origin || null,
                isFillBlank: q.isFillBlank,
                isMultiSelect: q.isMultiSelect,
                isAnswered: false,
                isCorrect: null,
                userSelection: null,
                isConfirmed: false,
                originalIndex: (q.originalIndex !== undefined && q.originalIndex !== -1)
                    ? q.originalIndex
                    : (questions ? questions.findIndex(origQ => origQ.question === q.question) : -1),
                reverseLabelMapping: q.reverseLabelMapping || null
            };
        });

        wrongQuestions = [];
        correct = 0;
        wrong = 0;
        currentIndex = 0;
        viewingIndex = 0;
        selectedOption = null;
        selectedOptions = [];
        initialQuestionCount = allQuestions.length;
        document.getElementById('correct').innerText = 0;
        document.getElementById('wrong').innerText = 0;
        isTestCompleted = false;

        if (endScreenDiv) endScreenDiv.remove();
        quizContainer.style.display = 'flex';

        createProgressDots();
        renderQuestion(currentIndex);
        saveProgress();
    });
    actionArea.appendChild(redoBtn);

    // Download Record Button
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'secondary-button';
    downloadBtn.id = 'downloadRecordBtn';
    downloadBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-280 200Zm-320 160q-33 0-56.5-23.5T80-240v-120h80v120h640v-120h80v120q0 33-23.5 56.5T800-160H160Z"/>
        </svg>
        <span>下載答題紀錄</span>
    `;
    downloadBtn.addEventListener('click', () => {
        const record = buildQuizRecord(allQuestions, {
            selectedJson,
            isMistakePracticeMode,
            sessionKind
        });
        downloadQuizRecord(record);
    });
    actionArea.appendChild(downloadBtn);

    // Reselect Quiz Button
    const resetBtn = document.createElement('button');
    resetBtn.className = wrongList.length ? 'secondary-button' : 'primary-button';
    resetBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M160-120v-480l320-240 320 240v480H520v-240h-80v240H160Z"/>
        </svg>
        <span>重新選題庫</span>
    `;
    resetBtn.querySelector('span').textContent = isMistakePracticeMode ? '返回錯題本' : '返回題庫';
    resetBtn.addEventListener('click', () => {
        reviewFlashcardsHandle?.abort();
        const wasPractice = isMistakePracticeMode;
        returnHome();
        if (wasPractice) openMistakeView();
    });
    actionArea.appendChild(resetBtn);

    container.appendChild(actionArea);
    endScreenDiv.appendChild(container);

    quizContainer.parentNode.appendChild(endScreenDiv);
    reviewFlashcardsHandle = mountReviewFlashcards(container, {
        questions: allQuestions,
        source: selectedJson,
        vocabulary,
        getKey: async () => (await get(ref(database, 'API_KEY'))).val(),
        showAlert: showCustomAlert,
        onOpenDeck: async (deckId) => {
            returnHome();
            await vocabulary.openDeck(deckId);
        }
    });
    container.tabIndex = -1;
    container.focus({ preventScroll: true });
}

function copyQuestion() {
    if (!currentQuestion.question) {
        alert('No question to copy.');
        return;
    }
    let textToCopy = '';
    textToCopy += 'Question:\n' + currentQuestion.question + '\n';
    for (let [optionKey, optionText] of getOrderedOptionEntries(currentQuestion.options)) {
        if (currentQuestion.isMultiSelect) {
            if (currentQuestion.answer.includes(optionKey)) {
                textToCopy += optionKey + ': ' + optionText + ' (Correct)\n';
            } else {
                textToCopy += optionKey + ': ' + optionText + '\n';
            }
        } else {
            if (optionKey === currentQuestion.answer) {
                textToCopy += optionKey + ': ' + optionText + ' (Correct)\n';
            } else {
                textToCopy += optionKey + ': ' + optionText + '\n';
            }
        }
    }
    textToCopy += '\nExplanation:\n' + (currentQuestion.explanation || 'No explanation provided.');
    navigator.clipboard.writeText(textToCopy).then(function () {
        showCustomAlert('題目已複製！');
    }, function (err) {
        alert('Could not copy text: ' + err);
    });
}

document.getElementById('startGame').addEventListener('click', () => {
    if (!selectedJson) {
        showCustomAlert('請選擇題庫！');
        return;
    }
    initQuiz().then(() => {
        saveProgress();
    });
});
document.getElementById('confirm-btn').addEventListener('click', confirmAnswer);
document.getElementById('next-btn').addEventListener('click', loadNewQuestion);
document.getElementById('copy-btn').addEventListener('click', copyQuestion);
const errataBtn = document.getElementById('errata-btn');
if (errataBtn) errataBtn.addEventListener('click', openErrataModal);
const errataCloseBtn = document.getElementById('errataCloseBtn');
if (errataCloseBtn) errataCloseBtn.addEventListener('click', () => { errataModal.style.display = 'none'; });
const errataCancelBtn = document.getElementById('errataCancelBtn');
if (errataCancelBtn) errataCancelBtn.addEventListener('click', () => { errataModal.style.display = 'none'; });
const errataSaveBtn = document.getElementById('errataSaveBtn');
if (errataSaveBtn) errataSaveBtn.addEventListener('click', saveErrataAnswer);
if (errataModal) errataModal.addEventListener('click', (e) => {
    if (e.target === errataModal) errataModal.style.display = 'none';
});
document.getElementById('restore').addEventListener('click', () => {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能恢復進度！');
        return;
    }
    restoreProgress();
});
document.getElementById('back-progress-btn').addEventListener('click', () => {
    renderQuestion(currentIndex);
});
document.getElementById('back-progress-btn-expl').addEventListener('click', () => {
    renderQuestion(currentIndex);
});

document.addEventListener('keydown', function (event) {
    if (document.querySelector('dialog[open]')) return;
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target.closest('button, summary, select') || (event.target.matches('input, textarea, [contenteditable]') && event.target !== fillblankInput)) return;
    if ([...document.querySelectorAll('.md3-modal-overlay, .modal, #mistakeView')].some(el => getComputedStyle(el).display !== 'none')) return;
    if (quizContainer.style.display === 'none' || !allQuestions.length) return;
    if (document.querySelector('.start-screen').style.display !== 'none') {
        if (event.key === 'Enter') {
            if (!selectedJson) {
                return;
            }
            document.getElementById('startGame').click();
            return;
        }
    }
    if (customAlert.classList.contains('show')) {
        if (event.key === 'Enter') {
            modalConfirmBtn.click();
            return;
        }
    }
    if (event.target === userQuestionInput) {
        return;
    }
    if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        weeGPTButton.click();
        return;
    }

    if (viewingIndex !== currentIndex) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const backBtn = document.getElementById('back-progress-btn');
            const backBtnExpl = document.getElementById('back-progress-btn-expl');
            if (backBtn && backBtn.style.display !== 'none') backBtn.click();
            else if (backBtnExpl && backBtnExpl.style.display !== 'none') backBtnExpl.click();
        }
        return;
    }

    const q = allQuestions[currentIndex];
    const isConfirmed = q ? q.isConfirmed : false;
    const validOptions = q && q.options ? Object.keys(q.options) : [];

    if (!isConfirmed && validOptions.includes(event.key.toUpperCase())) {
        const optionButton = document.querySelector(`.option-button[data-option='${event.key.toUpperCase()}']`);
        if (optionButton) {
            optionButton.click();
        }
    } else if (event.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && event.isComposing) {
            return;
        }
        if (activeEl === fillblankInput && event.shiftKey) {
            return;
        }

        if (!isConfirmed) {
            event.preventDefault();
            confirmAnswer();
        } else {
            loadNewQuestion();
        }
    }
});

document.getElementById('button-row').addEventListener('click', function (event) {
    if (event.target && (event.target.matches('button.select-button') || event.target.matches('button.quiz-list-item'))) {
        const selectedButton = event.target;
        // Do not deselect shuffle button if it's the one being clicked
        if (!selectedButton.id || selectedButton.id !== 'shuffleToggleBtn') {
            const allButtons = document.querySelectorAll('#button-row .select-button, #button-row .quiz-list-item');
            allButtons.forEach(btn => btn.classList.remove('selected'));
            selectedButton.classList.add('selected');
        }
        // Only update selectedJson if it's a quiz selection button
        if (selectedButton.dataset.json) {
            selectedJson = selectedButton.dataset.json;
        }
    }
});

function updateShuffleUI() {
    localStorage.setItem('shuffleQuiz', String(shouldShuffleQuiz));
    const st = document.getElementById('shuffleToggle');
    if (st) st.title = shouldShuffleQuiz ? '順序：隨機' : '順序：固定';
    const menuShuffleEl = document.getElementById('menuShuffle');
    if (menuShuffleEl) {
        const label = menuShuffleEl.querySelector('.item-label');
        if (label) label.textContent = '隨機順序（' + (shouldShuffleQuiz ? '亂序' : '照順序') + '）';
    }
}

const shuffleToggle = document.getElementById('shuffleToggle');
if (shuffleToggle) {
    shuffleToggle.addEventListener('click', () => {
        shouldShuffleQuiz = !shouldShuffleQuiz;
        shuffleToggle.classList.toggle('active');
        updateShuffleUI();
    });
    // Set initial state tooltip
    updateShuffleUI();
}




window.addEventListener("beforeunload", function (event) {
    // 只有在測驗中（有題庫且未完成）才跳出提示
    if ((selectedJson && !isTestCompleted)) {
        event.preventDefault();
        event.returnValue = '';
    }
});

function startTimer() {
    if (timerFrameId) cancelAnimationFrame(timerFrameId);

    if (!sessionTimeLimit) { timerDisplay.style.display = 'none'; return; }
    const duration = sessionTimeLimit * 1000;
    const endTime = Date.now() + duration;

    timerDisplay.innerHTML = ''; // Ensure no text
    timerDisplay.style.color = '';
    timerDisplay.style.display = 'flex';

    function loop() {
        const now = Date.now();
        let remaining = endTime - now;

        if (remaining < 0) remaining = 0;

        // Update Pie Chart Visual
        const pct = (remaining / duration) * 100;
        timerDisplay.style.setProperty('--progress', `${pct}%`);

        // Critical State Check
        if (remaining <= 5000) {
            timerDisplay.classList.add('critical');
        } else {
            timerDisplay.classList.remove('critical');
        }

        if (remaining > 0) {
            timerFrameId = requestAnimationFrame(loop);
        } else {
            // Time Up
            timerDisplay.classList.remove('critical');
            if (acceptingAnswers) {
                showCustomAlert('時間到！', 'critical-alert');
                // No vibration
            }
        }
    }

    loop();
}

function stopTimer() {
    if (timerFrameId) cancelAnimationFrame(timerFrameId);
    // Do not hide, keeps usage visible
}

// Catalog loading is separate from bank navigation and management state.
async function fetchQuizList() {
    const request = ++catalogRequest, uid = auth.currentUser?.uid, page = libraryPage;
    try {
        const data = await readCatalog();
        if (request !== catalogRequest || uid !== auth.currentUser?.uid || page !== libraryPage) return;
        catalogData = data;
        catalogPaths = Object.keys(data);
        bankLibrary.render(data, { archived: viewArchiveMode, folder: currentActiveFolder });
        questionSearch.setCatalog(data);
    } catch (error) {
        if (request !== catalogRequest || uid !== auth.currentUser?.uid || page !== libraryPage) return;
        questionSearch.catalogFailed();
        console.error('Failed to fetch quiz list:', error);
        const grid = document.getElementById('units-grid');
        grid.innerHTML = '<div class="empty-state"><p>題庫載入失敗，請確認連線後重試。</p><button class="quiet-button" id="retryCatalog">重新載入</button></div>';
        document.getElementById('retryCatalog').onclick = fetchQuizList;
    }
}

window.addEventListener('DOMContentLoaded', fetchQuizList);

// Quiz upload handling: preview and validate every bank before one atomic write.
const uploadModal = document.getElementById('uploadModal');
const uploadNameInput = document.getElementById('uploadNameInput');
const uploadNameLabel = document.getElementById('uploadNameLabel');
const uploadNameWrapper = document.getElementById('uploadNameWrapper');
const uploadConfirmBtn = document.getElementById('uploadConfirmBtn');
const uploadInput = document.getElementById('uploadJson');
const pasteJson = document.getElementById('pasteJson');
const fileDropZone = document.getElementById('fileDropZone');
const dropZoneLabel = document.getElementById('dropZoneLabel');
const uploadPreview = document.getElementById('uploadPreview');
const uploadSummary = document.getElementById('uploadSummary');
const uploadBankList = document.getElementById('uploadBankList');
const uploadError = document.getElementById('uploadError');
const importSyntaxIssue = document.getElementById('importSyntaxIssue');
const importIssueTitle = document.getElementById('importIssueTitle');
const importAutoRepairBtn = document.getElementById('importAutoRepairBtn');
const importTruncationPanel = document.getElementById('importTruncationPanel');
const importCopyPromptBtn = document.getElementById('importCopyPromptBtn');
const importRepairPrompt = document.getElementById('importRepairPrompt');
const importContinuationInput = document.getElementById('importContinuationInput');
const importMergeBtn = document.getElementById('importMergeBtn');
const importMergeStatus = document.getElementById('importMergeStatus');
const importRepairMode = document.getElementById('importRepairMode');
const importRepairModeWrapper = document.getElementById('importRepairModeWrapper');
const importRepairInputLabel = document.getElementById('importRepairInputLabel');
const importRepairInputHint = document.getElementById('importRepairInputHint');
const importRepairStatus = document.getElementById('importRepairStatus');
const jsonErrorEditor = mountJsonErrorEditor(pasteJson, document.getElementById('importJsonBackdrop'),
    document.getElementById('importErrorLocation'), document.getElementById('importJumpToErrorBtn'));
let currentRepairIssue = null;
const uploadModeRadios = uploadModal.querySelectorAll('input[name="upload-mode"]');
let pendingFiles = [];
let pendingPaste = null;
let fileHasBatch = false;
let pasteError = '';
let isUploading = false;
const uploadMode = () => Array.from(uploadModeRadios).find(r => r.checked)?.value || 'paste';
const activeImportBanks = () => uploadMode() === 'paste' ? pendingPaste?.banks || [] : pendingFiles;
const importHasTitles = () => uploadMode() === 'paste' ? !!pendingPaste?.isBatch : fileHasBatch;
const editableImportTitles = () => importHasTitles() || (uploadMode() === 'file' && pendingFiles.length > 1);

function importBanksWithTitles() {
    const customName = uploadNameInput.value.trim();
    return activeImportBanks().map(bank => ({
        ...bank,
        title: editableImportTitles() ? bank.title : customName || (uploadMode() === 'file' ? bank.title : '')
    }));
}

function validateImportPreview() {
    let error = uploadMode() === 'paste' ? pasteError : '';
    const banks = importBanksWithTitles();
    if (!error && banks.length) {
        try { buildImportChanges(banks, validBankName); } catch (err) { error = err.message; }
    }
    uploadError.textContent = error;
    uploadError.hidden = !error || (uploadMode() === 'paste' && !!pasteError);
    uploadConfirmBtn.disabled = isUploading || !!error || !banks.length;
    uploadConfirmBtn.textContent = isUploading ? '建立中…' : banks.length > 1 ? `建立 ${banks.length} 份題庫` : '建立';
}

function renderImportPreview() {
    const mode = uploadMode();
    uploadNameWrapper.hidden = importHasTitles();
    uploadNameLabel.textContent = mode === 'paste' ? '題庫名稱（科目｜單元名稱）'
        : pendingFiles.length > 1 ? '科目前綴（可留空）' : '題庫名稱（留空使用檔名）';
    const banks = importBanksWithTitles();
    uploadPreview.hidden = !banks.length;
    uploadSummary.textContent = `共 ${banks.length} 份題庫，${banks.reduce((sum, bank) => sum + bank.questions.length, 0)} 題`;
    uploadBankList.replaceChildren();
    banks.forEach((bank, index) => {
        const row = document.createElement('div');
        row.className = 'import-bank-row';
        if (editableImportTitles()) {
            const label = document.createElement('label');
            label.htmlFor = `importBankTitle${index}`;
            label.textContent = `第 ${index + 1} 份題庫標題`;
            const input = document.createElement('input');
            input.id = label.htmlFor; input.type = 'text'; input.value = bank.title;
            input.addEventListener('input', () => {
                activeImportBanks()[index].title = input.value;
                validateImportPreview();
            });
            row.append(label, input);
        } else {
            const title = document.createElement('span');
            title.textContent = bank.title || '尚未輸入題庫名稱';
            row.appendChild(title);
        }
        const count = document.createElement('span');
        count.className = 'import-bank-count'; count.textContent = `${bank.questions.length} 題`;
        row.appendChild(count); uploadBankList.appendChild(row);
    });
    validateImportPreview();
}

function updateFileDropZoneUI() {
    dropZoneLabel.textContent = pendingFiles.length
        ? `已選取 ${new Set(pendingFiles.map(bank => bank.fileName)).size} 個 JSON 檔案（${pendingFiles.length} 份題庫）`
        : '點擊或拖曳 JSON 檔案至此（支援多選）';
    renderImportPreview();
}

async function processUploadedFiles(fileList) {
    if (isUploading) return;
    if (!fileList?.length) return;
    const files = Array.from(fileList || []).filter(file => file.name.toLowerCase().endsWith('.json'));
    if (!files.length) { showCustomAlert('請提供 .json 格式的檔案'); return; }
    const loaded = [], errors = [];
    let hasBatch = false;
    for (const file of files) {
        let text;
        try {
            text = await file.text();
            const parsed = parseQuizImport(text, file.name.replace(/\.json$/i, ''));
            hasBatch ||= parsed.isBatch;
            loaded.push(...parsed.banks.map(bank => ({ ...bank, fileName: file.name, originalTitle: bank.title })));
        } catch (err) {
            if (files.length === 1 && text !== undefined) {
                openUploadModal('paste');
                uploadNameInput.value = file.name.replace(/\.json$/i, '');
                pasteJson.value = text;
                handlePasteJsonInput();
                return;
            }
            errors.push(`${file.name}（${err.message}）`);
        }
    }
    if (errors.length) {
        showCustomAlert(`部分檔案解析錯誤：\n${errors.join('\n')}`);
        if (!loaded.length) return;
    }
    pendingFiles = loaded; fileHasBatch = hasBatch;
    uploadNameInput.value = '';
    uploadModeRadios.forEach(radio => radio.checked = radio.value === 'file');
    document.getElementById('pasteSection').style.display = 'none';
    fileDropZone.style.display = 'block'; uploadModal.style.display = 'flex';
    updateFileDropZoneUI();
}

function clearPasteIssuePanels() {
    currentRepairIssue = null;
    jsonErrorEditor.setIssue(null);
    importRepairStatus.hidden = true;
    importRepairStatus.textContent = '';
    importCopyPromptBtn.textContent = '複製 repair prompt';
    if (importSyntaxIssue) importSyntaxIssue.hidden = true;
    if (importTruncationPanel) importTruncationPanel.hidden = true;
    if (importContinuationInput) importContinuationInput.value = '';
    if (importMergeStatus) {
        importMergeStatus.textContent = '';
        importMergeStatus.classList.remove('error');
    }
}

function handlePasteJsonInput() {
    pendingPaste = null;
    pasteError = '';
    clearPasteIssuePanels();
    // Wrappers are presentation, even when the JSON inside is still incomplete.
    const cleaned = stripMarkdownFences(pasteJson.value);
    if (cleaned !== pasteJson.value.trim()) pasteJson.value = cleaned;
    const rawText = pasteJson.value.trim();
    if (rawText) {
        try {
            pendingPaste = parseQuizImport(pasteJson.value);
        } catch (err) {
            pasteError = err.message;
            const diag = diagnoseJson(pasteJson.value);
            const isSchemaError = Array.isArray(err.path);
            const location = isSchemaError ? locateJsonPath(pasteJson.value, err.path) : diag.location;
            currentRepairIssue = { diag, location, message: err.message, path: err.path || [] };
            importSyntaxIssue.hidden = false;
            importIssueTitle.textContent = isSchemaError ? err.message : diag.message;
            // Balancing an unfinished document can silently omit questions.
            importAutoRepairBtn.hidden = isSchemaError || !diag.canAutoRepair || diag.isTruncated;
            importTruncationPanel.hidden = false;
            importRepairModeWrapper.hidden = !diag.isTruncated;
            importRepairMode.value = diag.isTruncated ? 'continuation' : 'replace';
            updateRepairMode();
            jsonErrorEditor.setIssue(location);
        }
    }
    renderImportPreview();
}

function openUploadModal(defaultMode = 'paste') {
    if (isUploading) return;
    uploadModal.style.display = 'flex';
    uploadModeRadios.forEach(radio => radio.checked = radio.value === defaultMode);
    document.getElementById('pasteSection').style.display = defaultMode === 'paste' ? 'block' : 'none';
    fileDropZone.style.display = defaultMode === 'file' ? 'block' : 'none';
    pasteJson.value = ''; uploadNameInput.value = ''; uploadInput.value = '';
    pendingFiles = []; pendingPaste = null; fileHasBatch = false; pasteError = '';
    clearPasteIssuePanels();
    updateFileDropZoneUI();
}

pasteJson.addEventListener('input', handlePasteJsonInput);

function updateRepairMode() {
    if (!currentRepairIssue) return;
    const { diag, location, message, path } = currentRepairIssue;
    const continuing = importRepairMode.value === 'continuation';
    importRepairPrompt.textContent = continuing ? diag.repairPrompt
        : buildJsonRepairPrompt(pasteJson.value, message, location, path);
    importRepairInputLabel.textContent = continuing ? '接續修補檔' : '完整修補 JSON';
    importRepairInputHint.textContent = continuing ? '可貼上包含 banks 的完整修補檔，系統會從截斷題接回並保留前文。' : '貼上包含全部題庫的完整 JSON，通過檢查後取代原文。';
    importMergeBtn.textContent = continuing ? '整合接續並檢查' : '套用修補並檢查';
    importCopyPromptBtn.textContent = '複製 repair prompt';
    importMergeStatus.textContent = '';
    importMergeStatus.classList.remove('error');
}
importRepairMode.addEventListener('change', updateRepairMode);

function applyRepairedImport(text, summary = '') {
    // Keep the original editor and pasted response intact if either syntax or schema fails.
    try { parseQuizImport(text); } catch (error) {
        importMergeStatus.textContent = `修補未套用：${error.message} 原始 JSON 已保留。`;
        importMergeStatus.classList.add('error');
        importMergeStatus.scrollIntoView({ block: 'nearest' });
        return false;
    }
    pasteJson.value = text;
    handlePasteJsonInput();
    importRepairStatus.textContent = summary ? `修補已套用。${summary}` : '修補已套用，題庫格式檢查通過。';
    importRepairStatus.hidden = false;
    importRepairStatus.scrollIntoView({ block: 'nearest' });
    return true;
}

importAutoRepairBtn?.addEventListener('click', () => {
    const repaired = autoRepairJson(pasteJson.value);
    if (repaired && repaired !== pasteJson.value) applyRepairedImport(repaired);
});

importCopyPromptBtn?.addEventListener('click', async () => {
    const promptText = importRepairPrompt.textContent;
    if (!promptText) return;
    try {
        await navigator.clipboard.writeText(promptText);
        importCopyPromptBtn.textContent = '已複製';
    } catch {
        importRepairPrompt.closest('details').open = true;
        importRepairPrompt.focus();
        const range = document.createRange();
        range.selectNodeContents(importRepairPrompt);
        const selection = window.getSelection();
        selection.removeAllRanges(); selection.addRange(range);
        importMergeStatus.textContent = '無法存取剪貼簿，請複製已選取的 repair prompt。';
        importMergeStatus.classList.add('error');
    }
});

function performMergeContinuation() {
    const response = importContinuationInput.value.trim();
    if (!response) {
        importMergeStatus.textContent = '請貼上修補結果。';
        importMergeStatus.classList.add('error');
        importMergeStatus.scrollIntoView({ block: 'nearest' });
        return;
    }
    if (importRepairMode.value === 'replace') {
        applyRepairedImport(stripMarkdownFences(response));
        return;
    }
    const result = mergeContinuation(pasteJson.value, response, parseQuizImport);
    if (result.success && result.mergedText) {
        applyRepairedImport(result.mergedText, result.summary);
    } else {
        importMergeStatus.textContent = result.error || '接續內容格式不正確，無法整合。';
        importMergeStatus.classList.add('error');
        importMergeStatus.scrollIntoView({ block: 'nearest' });
    }
}
importMergeBtn?.addEventListener('click', performMergeContinuation);
importContinuationInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        performMergeContinuation();
    }
});
uploadNameInput.addEventListener('input', () => {
    if (uploadMode() === 'file' && pendingFiles.length > 1 && !fileHasBatch) {
        const prefix = uploadNameInput.value.trim();
        pendingFiles.forEach(bank => {
            bank.title = !prefix || bank.originalTitle.startsWith(prefix) ? bank.originalTitle
                : prefix.endsWith('｜') ? prefix + bank.originalTitle : `${prefix}｜${bank.originalTitle}`;
        });
    }
    renderImportPreview();
});
uploadModeRadios.forEach(radio => radio.addEventListener('change', () => {
    document.getElementById('pasteSection').style.display = uploadMode() === 'paste' ? 'block' : 'none';
    fileDropZone.style.display = uploadMode() === 'file' ? 'block' : 'none';
    renderImportPreview();
}));
fileDropZone.addEventListener('click', () => uploadInput.click());
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => fileDropZone.addEventListener(event, e => {
    e.preventDefault(); e.stopPropagation();
}));
fileDropZone.addEventListener('dragover', () => fileDropZone.classList.add('dragover'));
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
fileDropZone.addEventListener('drop', async e => {
    fileDropZone.classList.remove('dragover');
    if (e.dataTransfer?.files) await processUploadedFiles(e.dataTransfer.files);
});
uploadInput.addEventListener('change', async e => {
    if (e.target.files) await processUploadedFiles(e.target.files);
});
uploadConfirmBtn.addEventListener('click', async () => {
    if (isUploading) return;
    try {
        const updates = buildImportChanges(importBanksWithTitles(), validBankName);
        isUploading = true;
        uploadModal.querySelector('.md3-dialog-body').inert = true;
        validateImportPreview();
        for (const name of Object.keys(updates)) {
            if (await bankExists(name)) throw new Error(`「${name}」已存在，請使用其他名稱。`);
        }
        await writeBanks(updates);
        const names = Object.keys(updates);
        showCustomAlert(names.length === 1 ? '題庫已新增：' + names[0] : `已新增 ${names.length} 份題庫。`);
        fetchQuizList(); uploadModal.style.display = 'none';
        pendingFiles = []; pendingPaste = null; pasteError = ''; fileHasBatch = false;
        uploadInput.value = ''; pasteJson.value = ''; uploadNameInput.value = '';
        clearPasteIssuePanels();
        updateFileDropZoneUI();
    } catch (err) {
        console.error(err);
        showCustomAlert(err.message || '建立失敗，請確認題庫格式與寫入權限。');
    } finally {
        isUploading = false;
        uploadModal.querySelector('.md3-dialog-body').inert = false;
        validateImportPreview();
    }
});
renderImportPreview();

// Helper function to render LaTeX in an element
function renderLatex(element) {
    if (!element) return;
    renderMathInElement(element, {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });
}



// WeeGPT相關程式碼
const weeGPTButton = document.getElementById('WeeGPT');
const inputSection = document.getElementById('WeeGPTInputSection');
const sendQuestionBtn = document.getElementById('sendQuestionBtn');
const stopQuestionBtn = document.getElementById('stopQuestionBtn');
const explanationDiv = document.getElementById('explanation');
const explanationText = document.getElementById('explanation-text');
const confirmBtn = document.getElementById('confirm-btn');
const starBtn = document.getElementById('starQuestion');
const showStarredBtn = document.getElementById('showStarredBtn');

let currentAbortController = null;
let chatRafId = null;

function renderChatDisplay(target = currentQuestion) {
    const display = document.getElementById('explanation-text');
    if (!display || !target) return;
    const baseExplanation = markdown(target.explanation || '尚無詳解');

    let baseHtml = '';
    if (target.isFillBlank) {
        if (target.aiGradeLoading) {
            baseHtml = `
                <div class="ai-grade-card loading">
                    <div class="ai-grade-loading-spinner">
                        <span class="chat-spinner-dot"></span>
                        <span>AI 評分中…</span>
                    </div>
                </div>
                <div class="original-explanation-section">
                    <div class="ai-grade-section-title">原始詳解</div>
                    <div class="original-explanation-content">${baseExplanation}</div>
                </div>
            `;
        } else if (target.aiGrade && !target.aiGrade.error) {
            const score = target.aiGrade.score;
            const tier = getScoreTier(score);
            const feedbackHtml = markdown(target.aiGrade.feedback || '評分完成。');
            baseHtml = `
                <div class="ai-grade-card ${tier.className}">
                    <div class="ai-grade-header">
                        <div class="ai-grade-badge">
                            <span class="ai-grade-score">${score}</span>
                            <span class="ai-grade-max">/ 10 分</span>
                            <span class="ai-grade-tier-tag">${tier.label}</span>
                        </div>
                        <div class="ai-grade-meter">
                            <div class="ai-grade-track">
                                <div class="ai-grade-fill" style="width: ${score * 10}%;"></div>
                            </div>
                            <div class="ai-grade-scale">
                                <span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span>
                            </div>
                        </div>
                    </div>
                    <div class="ai-grade-feedback">
                        <div class="ai-grade-section-title">評分說明</div>
                        <div class="ai-grade-feedback-content">${feedbackHtml}</div>
                    </div>
                </div>
                <hr class="explanation-divider">
                <div class="original-explanation-section">
                    <div class="ai-grade-section-title">原始詳解</div>
                    <div class="original-explanation-content">${baseExplanation}</div>
                </div>
            `;
        } else if (target.aiGrade && target.aiGrade.error) {
            baseHtml = `
                <div class="ai-grade-error-box">
                    <span>${target.aiGrade.message || 'AI 評分暫時無法取得。'}</span>
                    <button class="ai-grade-retry-btn" id="retryGradeBtn" type="button">重試評分</button>
                </div>
                <div class="original-explanation-section">
                    <div class="ai-grade-section-title">原始詳解</div>
                    <div class="original-explanation-content">${baseExplanation}</div>
                </div>
            `;
        } else {
            baseHtml = `
                <div class="original-explanation-section">
                    <div class="ai-grade-section-title">原始詳解</div>
                    <div class="original-explanation-content">${baseExplanation}</div>
                </div>
            `;
        }
    } else {
        baseHtml = baseExplanation;
    }

    if (!target.aiMessages || target.aiMessages.length === 0) {
        display.innerHTML = baseHtml;
        const retryBtn = display.querySelector('#retryGradeBtn');
        if (retryBtn) {
            retryBtn.onclick = () => retryGrading(target);
        }
        try { renderLatex(display); } catch {}
        return;
    }

    let chatHtml = '';
    for (const msg of target.aiMessages) {
        if (msg.role === 'user') {
            chatHtml += `
                <div class="chat-user-msg">
                    <span class="chat-role-label">提問</span>
                    <div class="chat-msg-body">${markdown(msg.content)}</div>
                </div>
            `;
        } else if (msg.role === 'assistant') {
            let bodyHtml = '';
            if (msg.content) {
                bodyHtml = `<div class="chat-msg-body">${markdown(msg.content)}</div>`;
            }
            let statusHtml = '';
            if (msg.status === 'streaming' && !msg.content) {
                statusHtml = `<div class="chat-streaming-loading"><span class="chat-spinner-dot"></span>正在思考中…</div>`;
            } else if (msg.status === 'interrupted') {
                statusHtml = `<div class="chat-status-badge interrupted">（已停止生成）</div>`;
            } else if (msg.status === 'error') {
                statusHtml = msg.content
                    ? `<div class="chat-status-badge error">（連線中斷）</div>`
                    : `<div class="chat-status-badge error">暫時無法取得 AI 回覆，請稍後再試。</div>`;
            }
            chatHtml += `
                <div class="chat-assistant-msg">
                    <span class="chat-role-label">AI 回覆</span>
                    ${bodyHtml}
                    ${statusHtml}
                </div>
            `;
        }
    }

    display.innerHTML = `${baseHtml}<hr class="explanation-divider"><div class="chat-thread">${chatHtml}</div>`;
    const retryBtn = display.querySelector('#retryGradeBtn');
    if (retryBtn) {
        retryBtn.onclick = () => retryGrading(target);
    }
    try { renderLatex(display); } catch {}
}

function scheduleChatRender(target) {
    if (chatRafId) return;
    chatRafId = requestAnimationFrame(() => {
        chatRafId = null;
        if (currentQuestion === target) {
            renderChatDisplay(target);
        }
    });
}

function flushChatRender(target) {
    if (chatRafId) {
        cancelAnimationFrame(chatRafId);
        chatRafId = null;
    }
    if (currentQuestion === target) {
        renderChatDisplay(target);
    }
}

weeGPTButton.addEventListener('click', () => {
    if (sessionMode === 'exam' && !isTestCompleted) return;
    if (!currentQuestion.question || !currentQuestion.options) {
        showCustomAlert('There is currently no question available for analysis.');
        return;
    }
    inputSection.style.display = inputSection.style.display === 'flex' ? 'none' : 'flex';
    if (inputSection.style.display === 'flex') {
        userQuestionInput.focus();
    }
});

stopQuestionBtn?.addEventListener('click', () => {
    if (currentAbortController) {
        currentAbortController.abort();
    }
});

sendQuestionBtn.addEventListener('click', async () => {
    const userQuestion = userQuestionInput.value.trim();
    if (!userQuestion || sendQuestionBtn.disabled) return;
    const target = currentQuestion;
    if (sessionMode === 'exam' && !isTestCompleted) return;

    target.usedAI = true;
    target.aiMessages ||= [];

    const userMsg = {
        id: 'user_' + Date.now(),
        role: 'user',
        content: userQuestion,
    };
    const assistantMsg = {
        id: 'asst_' + Date.now(),
        role: 'assistant',
        content: '',
        status: 'streaming',
    };
    target.aiMessages.push(userMsg, assistantMsg);

    userQuestionInput.value = '';
    sendQuestionBtn.style.display = 'none';
    if (stopQuestionBtn) stopQuestionBtn.style.display = 'flex';
    sendQuestionBtn.disabled = true;

    flushChatRender(target);

    currentAbortController = new AbortController();

    const systemInstruction = `你是專業的醫學學習助理。使用者正在檢視以下醫學題目，並向你提出疑問。

【參考題目與背景資料】（此資料僅供查閱與參考）：
題目：${target.question}
選項：${JSON.stringify(target.options || {})}
題庫答案：${JSON.stringify(target.answer)}${target.explanation ? `\n題庫詳解：${target.explanation}` : ''}

【回答原則】：
1. 直接聚焦回答使用者的具體提問，切入問題核心。
2. 題目與選項僅為參考背景（Reference），除非使用者明確要求，否則【絕對不要】主動重新回答一次題目，也【不要】逐一分析各個選項。
3. 請以繁體中文回答，清楚區分已知醫學事實與不確定之處。`;

    const contents = [];
    for (let i = 0; i < target.aiMessages.length; i++) {
        const m = target.aiMessages[i];
        if (m === assistantMsg) break;
        if (m.role === 'user') {
            contents.push({ role: 'user', parts: [{ text: m.content }] });
        } else if (m.role === 'assistant' && m.content) {
            contents.push({ role: 'model', parts: [{ text: m.content }] });
        }
    }

    let fallbackKey = '';
    try {
        const keySnap = await get(ref(database, 'API_KEY'));
        fallbackKey = typeof keySnap.val() === 'string' ? keySnap.val().trim() : '';
    } catch {}

    try {
        await streamGemini({
            contents,
            config: {
                systemInstruction,
            },
            model: 'gemini-2.5-flash-lite',
            apiKey: fallbackKey,
            signal: currentAbortController.signal,
            onStart: () => {
                scheduleChatRender(target);
            },
            onDelta: (delta, accumulated) => {
                assistantMsg.content = accumulated;
                scheduleChatRender(target);
            },
        });
        if (assistantMsg.status === 'streaming') {
            assistantMsg.status = 'complete';
        }
    } catch (error) {
        if (currentAbortController?.signal?.aborted || error.name === 'AbortError') {
            assistantMsg.status = 'interrupted';
            if (error.partialText && !assistantMsg.content) {
                assistantMsg.content = error.partialText;
            }
        } else {
            console.error('AI streaming request failed', error);
            assistantMsg.status = 'error';
            if (error.partialText && !assistantMsg.content) {
                assistantMsg.content = error.partialText;
            }
        }
    } finally {
        currentAbortController = null;
        sendQuestionBtn.style.display = 'flex';
        if (stopQuestionBtn) stopQuestionBtn.style.display = 'none';
        sendQuestionBtn.disabled = false;
        flushChatRender(target);
    }
});

userQuestionInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
        const isComposing = event.isComposing || event.target.getAttribute('aria-composing') === 'true';
        if (isComposing) {
            return;
        }
        event.preventDefault();
        sendQuestionBtn.click();
    }
});

function saveProgress() {
    if (!auth.currentUser || !selectedJson) return;
    allQuestions.forEach(q => {
        if (q.options) q.options = normalizeQuestionOptions(q.options);
        else delete q.options;
    });
    const uid = auth.currentUser.uid;
    const quizName = sessionKind === 'custom' || isMistakePracticeMode || allQuestions.some(q => q.sourcePath && q.sourcePath !== selectedJson) ? `session_${sessionId}` : getQuizStorageName(selectedJson);
    const progress = JSON.parse(JSON.stringify({ allQuestions, currentIndex, selectedJson, sessionId, sessionMode, sessionKind, sessionTimeLimit, lastUpdated: Date.now() }));
    userProgressCache[quizName] = progress;
    storage('cache', 'put', { id: `progress:${uid}:${quizName}`, uid, quizKey: quizName, value: progress }).catch(() => {});
    enqueue('progress', uid, { quizKey: quizName, progress }).catch(() => showCustomAlert('此瀏覽器無法保存離線資料，請勿關頁並檢查儲存空間。'));
}

function updateProgressBar(isCorrect = null) {
    updateDotsUI();
}

function rebuildMappingsAfterRestore() {
    allQuestions.forEach(q => {
        if (q.options) q.options = normalizeQuestionOptions(q.options);
        else delete q.options;
    });
    if (!questions || questions.length === 0) return;
    allQuestions.forEach(q => {
        if (q.originalIndex === undefined || q.originalIndex === -1) {
            q.originalIndex = questions.findIndex(origQ => origQ.question === q.question);
        }
        if (!q.isFillBlank && (!q.reverseLabelMapping || Object.keys(q.reverseLabelMapping).length === 0)) {
            const origQ = questions[q.originalIndex];
            if (origQ && origQ.options) {
                q.reverseLabelMapping = {};
                Object.entries(q.options).forEach(([newLabel, newText]) => {
                    const origEntry = Object.entries(origQ.options).find(([_, origText]) => origText === newText);
                    if (origEntry) {
                        q.reverseLabelMapping[newLabel] = origEntry[0];
                    }
                });
            }
        }
    });
}

function restoreProgress(quizName = null) {
    isMistakePracticeMode = false;
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能恢復進度！');
        return;
    }

    let getQuizNamePromise;
    if (quizName) {
        getQuizNamePromise = Promise.resolve(quizName);
    } else {
        getQuizNamePromise = get(ref(database, `progress/${auth.currentUser.uid}/lastActive`)).then(snapshot => {
            if (snapshot.exists()) {
                return snapshot.val().quizName;
            }
            const keys = Object.keys(userProgressCache);
            if (keys.length > 0) {
                let latestQuiz = null;
                let maxTime = 0;
                for (const key of keys) {
                    const p = userProgressCache[key];
                    if (p.lastUpdated && p.lastUpdated > maxTime) {
                        maxTime = p.lastUpdated;
                        latestQuiz = key;
                    }
                }
                if (latestQuiz) return latestQuiz;
            }
            throw new Error('No last active quiz found');
        });
    }

    getQuizNamePromise.then(resolvedQuizName => {
        const local = userProgressCache[resolvedQuizName];
        if (local) return { exists: () => true, val: () => local };
        return get(ref(database, `progress/${auth.currentUser.uid}/quizzes/${resolvedQuizName}`));
    }).then(async snapshot => {
        if (!snapshot.exists()) {
            showCustomAlert('沒有找到已保存的進度！');
            return;
        }
        const p = snapshot.val();
        sessionId = p.sessionId || crypto.randomUUID();
        sessionMode = p.sessionMode || 'study';
        sessionKind = p.sessionKind || 'bank';
        sessionTimeLimit = p.sessionTimeLimit ?? 15;
        document.body.classList.toggle('exam-active', sessionMode === 'exam');

        if (p.allQuestions) {
            allQuestions = p.allQuestions;
            currentIndex = p.currentIndex;
            selectedJson = p.selectedJson;
        } else {
            allQuestions = [];

            if (p.questionHistory) {
                p.questionHistory.forEach(h => {
                    const q = h.questionState;
                    q.isAnswered = true;
                    q.isConfirmed = true;
                    q.userSelection = h.userSelection;

                    if (q.isFillBlank) {
                        const sentence = (h.userSelection || '').trim().toLowerCase();
                        const required = Array.isArray(q.answer) ? q.answer : [q.answer];
                        q.isCorrect = required.every(keyword => sentence.includes(keyword.toLowerCase()));
                    } else if (q.isMultiSelect) {
                        q.isCorrect = (h.userSelection.length === q.answer.length) &&
                            q.answer.every(opt => h.userSelection.includes(opt));
                    } else {
                        q.isCorrect = h.userSelection === q.answer;
                    }
                    allQuestions.push(q);
                });
            }

            if (p.currentQuestion && p.currentQuestion.question) {
                const q = p.currentQuestion;
                if (p.acceptingAnswers === false || (p.questionHistory && p.questionHistory.length > 0 && p.questionHistory[p.questionHistory.length - 1].questionState.question === q.question)) {
                    // Already in history
                } else {
                    q.isAnswered = false;
                    q.isConfirmed = false;
                    q.userSelection = null;
                    q.isCorrect = null;
                    allQuestions.push(q);
                }
            }

            if (p.questions) {
                p.questions.forEach(q => {
                    q.isAnswered = false;
                    q.isConfirmed = false;
                    q.userSelection = null;
                    q.isCorrect = null;
                    allQuestions.push(q);
                });
            }

            currentIndex = p.questionHistory ? p.questionHistory.length : 0;
            selectedJson = p.selectedJson;
        }

        allQuestions.forEach(q => {
            if (q.options) {
                q.options = normalizeQuestionOptions(q.options);
            } else {
                delete q.options;
            }
        });

        selectedJson = catalogPaths.find(path => getQuizStorageName(path) === getQuizStorageName(selectedJson)) || selectedJson;
        await loadQuestions();
        rebuildMappingsAfterRestore();
        isMistakePracticeMode = false;
        isTestCompleted = currentIndex >= allQuestions.length;

        viewingIndex = currentIndex;
        selectedOption = null;
        selectedOptions = [];

        if (currentIndex >= allQuestions.length) {
            viewingIndex = Math.max(0, allQuestions.length - 1);
        }

        document.querySelector('.start-screen').style.display = 'none';
        document.querySelector('.quiz-container').style.display = 'flex';
        const fileName = selectedJson.split('/').pop().replace('.json', '');
        document.querySelector('.quiz-title').innerText = `${fileName}`;
        document.title = `${fileName} - 題矣`;

        let cCount = 0;
        let wCount = 0;
        allQuestions.forEach(q => {
            if (q.isAnswered) {
                if (q.isCorrect) cCount++;
                else wCount++;
            }
        });
        correct = sessionMode === 'exam' && !isTestCompleted ? 0 : cCount;
        wrong = sessionMode === 'exam' && !isTestCompleted ? 0 : wCount;
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;

        initialQuestionCount = allQuestions.length;

        createProgressDots();
        renderQuestion(viewingIndex);
        showCustomAlert('進度已成功恢復！');
    }).catch(error => {
        console.error('恢復進度失敗：', error);
        showCustomAlert('恢復進度時發生錯誤，請重試。');
    });
}


const defaultSignInLabel = '使用 Google 帳戶登入';
const googleLogoSvg = '<svg class="g-logo" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"></path><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.715H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"></path><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.547 0 9c0 1.453.347 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"></path><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.159 6.656 3.58 9 3.58z" fill="#EA4335"></path></svg>';

function updateSignInButton(user) {
    if (!signInBtn) return;

    if (user) {
        signInBtn.style.display = 'none';
        signInBtn.classList.remove('profile-mode');
    } else {
        signInBtn.style.display = 'inline-flex';
        signInBtn.innerHTML = `${googleLogoSvg}<span class="sign-in-text">${defaultSignInLabel}</span>`;
        signInBtn.classList.remove('profile-mode');
        signInBtn.setAttribute('title', defaultSignInLabel);
        signInBtn.setAttribute('aria-label', defaultSignInLabel);
    }
}

// Auth UI sync will be wired after controls menu elements are initialized

const GOOGLE_CLIENT_ID = '1032461117274-4norhm66l02foocbd94rr53kqbglnflg.apps.googleusercontent.com';
let googleTokenClient = null;

function handleSignInError(error) {
    showCustomAlert(formatSignInErrorMessage(error));
}

function initGoogleTokenClient() {
    if (typeof window === 'undefined' || !window.google?.accounts?.oauth2) return;
    try {
        googleTokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'openid email profile',
            callback: async (tokenResponse) => {
                if (tokenResponse.error) {
                    console.error('Google OAuth 回傳錯誤:', tokenResponse);
                    handleSignInError(tokenResponse);
                    return;
                }
                try {
                    console.log('透過 Google OAuth Token 登入 Firebase...');
                    const credential = GoogleAuthProvider.credential(null, tokenResponse.access_token);
                    const result = await signInWithCredential(auth, credential);
                    console.log('GIS 登入成功，使用者:', result.user);
                    showCustomAlert('登入成功！');
                } catch (err) {
                    console.error('GIS signInWithCredential 失敗:', err);
                    handleSignInError(err);
                }
            },
            error_callback: (nonOAuthErr) => {
                console.error('GIS 視窗或非 OAuth 錯誤:', nonOAuthErr);
                handleSignInError(nonOAuthErr);
            }
        });
    } catch (e) {
        console.warn('initGoogleTokenClient 失敗:', e);
    }
}

function initGoogleIdentityServices() {
    if (typeof window === 'undefined' || !window.google?.accounts?.id) return;
    try {
        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
                if (!response?.credential) return;
                try {
                    console.log('透過 Google ID Token 憑證登入 Firebase...');
                    const credential = GoogleAuthProvider.credential(response.credential);
                    const result = await signInWithCredential(auth, credential);
                    console.log('GIS ID Token 登入成功:', result.user);
                    showCustomAlert('登入成功！');
                } catch (err) {
                    console.error('GIS signInWithCredential 失敗:', err);
                    handleSignInError(err);
                }
            },
            auto_select: false,
            cancel_on_tap_outside: true
        });
    } catch (e) {
        console.warn('GIS 初始化失敗:', e);
    }
}

function setupGoogleServices() {
    if (typeof window === 'undefined') return;
    if (window.google?.accounts) {
        initGoogleTokenClient();
        initGoogleIdentityServices();
    } else {
        window.addEventListener('load', () => {
            if (window.google?.accounts) {
                initGoogleTokenClient();
                initGoogleIdentityServices();
            }
        });
    }
}
setupGoogleServices();

// 處理自 Google OAuth 原生重定向返回的 ID Token（特別針對 iOS Standalone PWA 模式）
async function handleOAuthRedirectResult() {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash || (!hash.includes('id_token=') && !hash.includes('error='))) return;

    const { idToken, error, errorDescription } = parseAuthHash(hash);
    try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {}

    if (error) {
        console.error('Google OAuth 重定向回傳錯誤:', error, errorDescription);
        handleSignInError({ code: error, message: errorDescription });
        return;
    }

    if (idToken) {
        try {
            console.log('接收到 Google ID Token，進行 Firebase 登入...');
            const credential = GoogleAuthProvider.credential(idToken);
            const result = await signInWithCredential(auth, credential);
            console.log('Google 重定向登入成功，使用者:', result.user);
            showCustomAlert('登入成功！');
        } catch (err) {
            console.error('透過 Google ID Token 登入 Firebase 失敗:', err);
            handleSignInError(err);
        }
    }
}
handleOAuthRedirectResult();

async function handleGoogleSignIn() {
    if (isInAppBrowser()) {
        showCustomAlert('偵測到您正在使用 LINE、Facebook 或 Instagram 內建瀏覽器。\n\n這些環境會限制儲存空間，導致 Google 登入失敗。\n\n建議點擊畫面右上角選單，選擇「在瀏覽器中開啟」或使用 Safari / Chrome 開啟此網頁進行登入。');
        return;
    }

    // 若在 iOS 主畫面 standalone PWA 模式下，因 WebKit 容器嚴重限制彈出視窗與多視窗通訊，
    // 直接發起原生 Google OpenID Connect 重定向流程（回到 jedieason.github.io/Teah，完全不經由 firebaseapp.com）：
    if (isIosStandalone()) {
        try {
            console.log('iOS Standalone PWA 模式：發起原生 Google OpenID Connect 重定向...');
            const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
            const redirectUri = getCanonicalRedirectUri();
            const authUrl = buildGoogleAuthUrl({
                clientId: GOOGLE_CLIENT_ID,
                redirectUri,
                nonce
            });
            window.location.href = authUrl;
            return;
        } catch (e) {
            console.warn('原生 Google 重定向構建失敗，改用備用流程:', e);
        }
    }

    // 一般瀏覽器環境：優先使用 Google Token Client（GIS OAuth2 視窗）
    if (!googleTokenClient && window.google?.accounts?.oauth2) {
        initGoogleTokenClient();
    }

    if (googleTokenClient) {
        try {
            console.log('使用 Google Token Client 啟動登入...');
            googleTokenClient.requestAccessToken({ prompt: '' });
            return;
        } catch (e) {
            console.warn('Google Token Client 觸發失敗，改用 Firebase Popup:', e);
        }
    }

    // 備用方案：在當前點擊事件同步觸發 Firebase Popup（絕不自動跳轉 Firebase Redirect，避免 cross-domain 儲存隔離錯誤）
    try {
        console.log('Starting Google Sign-In with Popup...');
        const result = await signInWithPopup(auth, googleProvider);
        console.log('Google Sign-In success, user:', result.user);
        showCustomAlert('登入成功！');
    } catch (error) {
        console.error('Google 登入失敗:', error);
        handleSignInError(error);
    }
}

// 監聽 Firebase 舊重定向結果（若曾有舊重定向）
try {
    getRedirectResult(auth).then((result) => {
        if (result?.user) {
            console.log('Google 重定向登入成功，使用者:', result.user);
            showCustomAlert('登入成功！');
        }
    }).catch((error) => {
        console.error('Google 重定向登入失敗:', error);
    });
} catch (e) {
    console.warn('getRedirectResult 執行異常:', e);
}

if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
        if (auth.currentUser) {
            try {
                await signOut(auth);
                showCustomAlert('已成功登出');
            } catch (error) {
                console.error('登出失敗:', error);
                showCustomAlert('登出失敗，請稍後再試');
            }
            return;
        }
        await handleGoogleSignIn();
    });
}


// Delegate click to close any modal when '×' is clicked
document.addEventListener('click', (e) => {
    if (e.target.closest('.modal-close')) {
        const modal = e.target.closest('.modal') || e.target.closest('.md3-modal-overlay');
        if (modal) {
            modal.style.display = 'none';
        }
    }
});

// Controls dropdown (top-right)
const controlsMenuBtn = document.getElementById('controlsMenuBtn');
const controlsMenu = document.getElementById('controlsMenu');
const controlsAvatar = document.getElementById('controlsAvatar');
const menuAvatar = document.getElementById('menuAvatar');
const menuDisplayName = document.getElementById('menuDisplayName');
const menuEmail = document.getElementById('menuEmail');
const menuShuffle = document.getElementById('menuShuffle');
const menuTheme = document.getElementById('menuTheme');
const menuLogout = document.getElementById('menuLogout');
const menuContribute = document.getElementById('menuContribute');
const menuAddQuiz = document.getElementById('menuAddQuiz');

function closeControlsMenu() {
    if (!controlsMenu) return;
    if (document.activeElement && controlsMenu.contains(document.activeElement)) {
        if (controlsMenuBtn && controlsMenuBtn.style.display !== 'none') {
            controlsMenuBtn.focus();
        } else {
            document.activeElement.blur();
        }
    }
    controlsMenu.classList.remove('open');
    controlsMenuBtn?.setAttribute('aria-expanded', 'false');
    controlsMenu.setAttribute('aria-hidden', 'true');
}

if (controlsMenuBtn && controlsMenu) {
    controlsMenuBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // If not logged in, this button acts as the sign-in trigger
        if (!auth.currentUser) {
            await handleGoogleSignIn();
            return;
        }
        const open = controlsMenu.classList.toggle('open');
        controlsMenuBtn.setAttribute('aria-expanded', String(open));
        controlsMenu.setAttribute('aria-hidden', String(!open));
    });
    document.addEventListener('click', (e) => {
        // Close if clicking outside
        if (!controlsMenu.contains(e.target) && !controlsMenuBtn?.contains(e.target)) {
            if (controlsMenu.classList.contains('open')) {
                closeControlsMenu();
            }
        }
        // Also close if clicking an item inside (except container clicks)
        if (controlsMenu.contains(e.target) && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
            closeControlsMenu();
        }
    });
}

// Sync user info into controls menu when auth state changes
function syncControlsUser(user) {
    if (!controlsAvatar || !menuAvatar || !menuDisplayName || !menuEmail) return;
    const isLoggedIn = !!user;

    // Hide controls menu button if not logged in
    if (controlsMenuBtn) {
        controlsMenuBtn.style.display = isLoggedIn ? 'inline-flex' : 'none';
    }

    // Ensure the menu is closed when logged out
    if (!isLoggedIn && controlsMenu) {
        closeControlsMenu();
    }

    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserSub = document.getElementById('sidebarUserSub');

    if (user) {
        controlsAvatar.src = user.photoURL || 'Images/logo.png';
        menuAvatar.src = user.photoURL || 'Images/logo.png';
        menuDisplayName.textContent = user.displayName || user.email || 'Google 帳號';
        menuEmail.textContent = user.email || '';
        if (sidebarUserName) sidebarUserName.textContent = user.displayName || user.email || 'Google 帳號';
        if (sidebarUserSub) sidebarUserSub.textContent = user.email || '已登入';
        controlsMenuBtn.setAttribute('title', menuDisplayName.textContent);
    } else {
        // Not strictly necessary to update content if hidden, but good for state consistency
        controlsAvatar.src = 'Images/logo.png';
        menuAvatar.src = 'Images/logo.png';
        menuDisplayName.textContent = '尚未登入';
        menuEmail.textContent = '';
        if (sidebarUserName) sidebarUserName.textContent = '尚未登入';
        if (sidebarUserSub) sidebarUserSub.textContent = 'Google 帳號';
        controlsMenuBtn.setAttribute('title', 'Google 登入');
    }
}

// Now that controls elements exist, hook auth state listeners and initial sync
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed, user:', user ? user.displayName : 'Logged out');
    updateSignInButton(user);
    syncControlsUser(user);
    collection.resetForUser(user?.uid);
    vocabulary.resetForUser(user?.uid);
    questionSearch.resetForUser(user?.uid);
    bankLibrary.resetForUser();
    if (user) {
        await fetchUserProgressAndMistakes(user);
    } else {
        userProgressCache = {};
        userMistakesCache = {};
        userStarredCache = [];
        learningDataReady = false;
        await loadLearning();
        closeMistakeView();
        stopTimer();
        quizContainer.style.display = 'none';
        document.querySelector('.start-screen').style.display = 'flex';
    }
    updateRestorePreview(user);
    fetchQuizList();
});

updateSignInButton(auth.currentUser);
syncControlsUser(auth.currentUser);

// Controls item actions (text-only click)
if (menuShuffle) menuShuffle.addEventListener('click', () => {
    // toggle shuffle state same as clicking the slider
    shouldShuffleQuiz = !shouldShuffleQuiz;
    const st = document.getElementById('shuffleToggle');
    if (st) st.classList.toggle('active');
    updateShuffleUI();
});
if (menuTheme) menuTheme.addEventListener('click', () => {
    toggleTheme();
});
if (menuLogout) menuLogout.addEventListener('click', async () => {
    if (!auth.currentUser) return;
    try {
        await signOut(auth);
        showCustomAlert('已登出 Google 帳號。');
    } catch (error) {
        console.error('Sign-out failed:', error);
        showCustomAlert('登出失敗，請稍後再試。');
    }
});

// Edit Quiz Name from controls menu
const menuEditQuizName = document.getElementById('menuEditQuizName');
let viewArchiveMode = false;
let currentActiveFolder = null;
let libraryPage = 'library';
const libraryLocations = { library: { folder: null, scroll: 0, query: '' }, archive: { folder: null, scroll: 0, query: '' }, collection: { scroll: 0 }, flashcard: { scroll: 0 } };
function showLibraryPage(page) {
    const old = libraryLocations[libraryPage];
    if (page !== libraryPage) { old.scroll = window.scrollY; bankLibrary.stopManaging(); }
    if (['library', 'archive'].includes(libraryPage)) { old.folder = currentActiveFolder; old.query = document.getElementById('bankSearch').value; }
    libraryPage = page;
    questionSearch.cancel();
    document.querySelector('.home-content').hidden = ['collection', 'flashcard'].includes(page);
    document.getElementById('collectionPage').hidden = page !== 'collection';
    document.getElementById('flashcardPage').hidden = page !== 'flashcard';
    closeControlsMenu();
    for (const [id, name] of [['homeLibrary', 'library'], ['homeStarred', 'collection'], ['homeArchive', 'archive']]) {
        const button = document.getElementById(id);
        if (page === name) button?.setAttribute('aria-current', 'page'); else button?.removeAttribute('aria-current');
    }
    const tabLibrary = document.getElementById('tabLibrary');
    const tabFlashcard = document.getElementById('tabFlashcard');
    if (tabLibrary && tabFlashcard) {
        const isLib = page === 'library';
        const isFlash = page === 'flashcard';
        tabLibrary.classList.toggle('active', isLib);
        tabLibrary.setAttribute('aria-selected', String(isLib));
        tabFlashcard.classList.toggle('active', isFlash);
        tabFlashcard.setAttribute('aria-selected', String(isFlash));
    }
    if (['library', 'archive'].includes(page)) {
        viewArchiveMode = page === 'archive';
        currentActiveFolder = libraryLocations[page].folder;
        document.getElementById('libraryPageTitle').textContent = viewArchiveMode ? '典藏庫' : '題庫';
        document.querySelector('.home-content').classList.toggle('archive-page', viewArchiveMode);
        const search = document.getElementById('bankSearch');
        search.placeholder = viewArchiveMode ? '搜尋典藏題庫、題目或選項' : '搜尋題庫、題目或選項';
        search.value = libraryLocations[page].query;
        const requested = page;
        fetchQuizList().then(() => { if (libraryPage === requested) window.scrollTo(0, libraryLocations[page].scroll); });
    } else window.scrollTo(0, libraryLocations[page].scroll);
}

if (menuEditQuizName) menuEditQuizName.addEventListener('click', () => {
    if (!['library', 'archive'].includes(libraryPage)) showLibraryPage('library');
    bankLibrary.toggleManage();
    closeControlsMenu();
});

// Open upload modal from controls menu
if (menuAddQuiz) menuAddQuiz.addEventListener('click', () => {
    closeControlsMenu();
    openUploadModal('paste');
});

// Contribute Quiz Modal Logic
const contributeModal = document.getElementById('contributeModal');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const copyPromptLabel = document.getElementById('copyPromptLabel');
const promptBoxTitle = document.getElementById('promptBoxTitle');
const promptCodeBlock = document.getElementById('promptCodeBlock');
const contributeGoUploadBtn = document.getElementById('contributeGoUploadBtn');
const promptModeFull = document.getElementById('promptModeFull');
const promptModeCategorized = document.getElementById('promptModeCategorized');
const promptModeSingle = document.getElementById('promptModeSingle');
const promptSingleToolbar = document.getElementById('promptSingleToolbar');
const promptCategorizedToolbar = document.getElementById('promptCategorizedToolbar');
const promptUnitInput = document.getElementById('promptUnitInput');
const promptCustomUnitsInput = document.getElementById('promptCustomUnitsInput');
const promptSubjectInput = document.getElementById('promptSubjectInput');
const promptSubjectToolbar = document.getElementById('promptSubjectToolbar');

let currentPromptMode = 'full';

function getCurrentPromptText() {
    if (currentPromptMode === 'single') {
        const val = promptUnitInput ? promptUnitInput.value : '';
        return buildSingleUnitPrompt(val);
    }
    if (currentPromptMode === 'categorized') {
        const subject = promptSubjectInput ? promptSubjectInput.value : '';
        const units = promptCustomUnitsInput ? promptCustomUnitsInput.value : '';
        return buildCategorizedPrompt(subject, units);
    }
    return buildMultiUnitPrompt(promptSubjectInput.value);
}

function updatePromptDisplay() {
    try {
        promptCodeBlock.textContent = getCurrentPromptText();
        copyPromptBtn.disabled = false;
    } catch (error) {
        promptCodeBlock.textContent = error.message;
        copyPromptBtn.disabled = true;
    }
    if (currentPromptMode === 'single') {
        const unitName = (promptUnitInput?.value || '').trim() || 'B12 考古';
        if (promptBoxTitle) promptBoxTitle.textContent = `AI 題庫整理 Prompt（單一題庫：${unitName}）`;
        if (copyPromptLabel) copyPromptLabel.textContent = '複製單一題庫 Prompt';
    } else if (currentPromptMode === 'categorized') {
        const units = parseCustomUnits(promptCustomUnitsInput ? promptCustomUnitsInput.value : '');
        const countText = units.length ? `：共 ${units.length} 個單元` : '';
        if (promptBoxTitle) promptBoxTitle.textContent = `AI 題庫整理 Prompt（依單元分類${countText}）`;
        if (copyPromptLabel) copyPromptLabel.textContent = '複製依單元分類 Prompt';
    } else {
        if (promptBoxTitle) promptBoxTitle.textContent = 'AI 題庫整理 Prompt（多份題庫）';
        if (copyPromptLabel) copyPromptLabel.textContent = '複製多份題庫 Prompt';
    }
}

function setPromptMode(mode) {
    currentPromptMode = mode;
    const modeTabs = [
        { el: promptModeFull, name: 'full' },
        { el: promptModeCategorized, name: 'categorized' },
        { el: promptModeSingle, name: 'single' }
    ];
    modeTabs.forEach(({ el, name }) => {
        if (!el) return;
        const isActive = name === mode;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const subjectHint = document.getElementById('promptSubjectHint');

    if (mode === 'full') {
        if (promptSingleToolbar) promptSingleToolbar.style.display = 'none';
        if (promptCategorizedToolbar) promptCategorizedToolbar.style.display = 'none';
        if (promptSubjectToolbar) promptSubjectToolbar.style.display = 'flex';
        if (promptSubjectInput) promptSubjectInput.required = true;
        if (subjectHint) subjectHint.textContent = '題庫會依 PDF 目錄命名為「科目｜年份 考古」或「科目｜單元」。';
        updatePromptDisplay();
        promptSubjectInput?.focus();
    } else if (mode === 'categorized') {
        if (promptSingleToolbar) promptSingleToolbar.style.display = 'none';
        if (promptCategorizedToolbar) promptCategorizedToolbar.style.display = 'flex';
        if (promptSubjectToolbar) promptSubjectToolbar.style.display = 'flex';
        if (promptSubjectInput) promptSubjectInput.required = true;
        if (subjectHint) subjectHint.textContent = '題庫會命名為「科目｜單元名稱」，做為所有單元題庫的固定前綴。';
        updatePromptDisplay();
        if (!promptSubjectInput?.value?.trim()) {
            promptSubjectInput?.focus();
        } else {
            promptCustomUnitsInput?.focus();
        }
    } else if (mode === 'single') {
        if (promptSingleToolbar) promptSingleToolbar.style.display = 'flex';
        if (promptCategorizedToolbar) promptCategorizedToolbar.style.display = 'none';
        if (promptSubjectToolbar) promptSubjectToolbar.style.display = 'none';
        if (promptSubjectInput) promptSubjectInput.required = false;
        updatePromptDisplay();
        promptUnitInput?.focus();
    }
}

if (promptModeFull) promptModeFull.addEventListener('click', () => setPromptMode('full'));
if (promptModeCategorized) promptModeCategorized.addEventListener('click', () => setPromptMode('categorized'));
if (promptModeSingle) promptModeSingle.addEventListener('click', () => setPromptMode('single'));

promptSubjectInput?.addEventListener('input', () => {
    if (currentPromptMode === 'full' || currentPromptMode === 'categorized') updatePromptDisplay();
});

if (promptCustomUnitsInput) {
    promptCustomUnitsInput.addEventListener('input', () => {
        if (currentPromptMode === 'categorized') updatePromptDisplay();
    });
}

if (promptUnitInput) {
    promptUnitInput.addEventListener('input', () => {
        if (currentPromptMode === 'single') {
            updatePromptDisplay();
        }
    });
}

if (contributeModal) {
    const chipBtns = contributeModal.querySelectorAll('.prompt-chip');
    chipBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const unit = btn.dataset.unit;
            if (unit && promptUnitInput) {
                promptUnitInput.value = unit;
                if (currentPromptMode === 'single') {
                    updatePromptDisplay();
                }
            }
        });
    });
}

updatePromptDisplay();

if (menuContribute) {
    menuContribute.addEventListener('click', () => {
        closeControlsMenu();
        if (contributeModal) contributeModal.style.display = 'flex';
        if (currentPromptMode === 'full' || currentPromptMode === 'categorized') {
            if (!promptSubjectInput?.value?.trim()) {
                promptSubjectInput?.focus();
            } else if (currentPromptMode === 'categorized') {
                promptCustomUnitsInput?.focus();
            }
        } else if (currentPromptMode === 'single') {
            promptUnitInput?.focus();
        }
    });
}

if (contributeGoUploadBtn) {
    contributeGoUploadBtn.addEventListener('click', () => {
        if (contributeModal) contributeModal.style.display = 'none';
        openUploadModal('paste');
    });
}

if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', async () => {
        if (copyPromptBtn.disabled) return;
        const textToCopy = getCurrentPromptText();
        try {
            await navigator.clipboard.writeText(textToCopy);
        } catch (e) {
            const textarea = document.createElement('textarea');
            textarea.value = textToCopy;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        copyPromptBtn.classList.add('copied');
        const label = copyPromptLabel || copyPromptBtn.querySelector('.copy-label');
        if (label) label.textContent = '已複製 ✓';
        setTimeout(() => {
            copyPromptBtn.classList.remove('copied');
            updatePromptDisplay();
        }, 2000);
    });
}

if (contributeModal) {
    const specTabs = contributeModal.querySelectorAll('.spec-tab');
    specTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            specTabs.forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            const targetTab = tab.dataset.tab;
            const panels = contributeModal.querySelectorAll('.spec-tab-panel');
            panels.forEach(p => (p.style.display = 'none'));
            const targetPanel = contributeModal.querySelector(`#tab-${targetTab}`);
            if (targetPanel) targetPanel.style.display = 'block';
        });
    });
}

// Initialize shuffle state label in menu on load
updateShuffleUI();

let userStarredCache = [];

function setStarState(isFilled) {
    if (!starBtn) return;
    if (isFilled) {
        starBtn.classList.add('active');
    } else {
        starBtn.classList.remove('active');
    }
}

function sameStar(a, b) {
    if (a.questionId && b.questionId && a.questionId === b.questionId) return true;
    const aSrc = getQuizStorageName(a.source || '');
    const bSrc = getQuizStorageName(b.source || '');
    return a.question === b.question && aSrc === bSrc;
}
async function updateStarIcon() {
    if (!starBtn) return;
    const question = currentQuestion;
    const source = getQuizStorageName(question.sourcePath || selectedJson);
    setStarState(false);
    if (!auth.currentUser) return;
    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        const list = Array.isArray(snap.val()) ? snap.val() : [];
        userStarredCache = list;
        if (currentQuestion === question) setStarState(list.some(q => sameStar(q, { ...question, source })));
    } catch (error) { console.error('讀取收藏失敗', error); }
}
async function toggleStarCurrentQuestion() {
    if (!auth.currentUser) { showCustomAlert('登入後即可收藏題目。'); return; }
    const question = currentQuestion;
    const entry = { ...canonicalQuestion(question), questionId: question.questionId || null, source: getQuizStorageName(question.sourcePath || selectedJson) };
    starBtn.disabled = true;
    try {
        const result = await runTransaction(ref(database, `progress/${auth.currentUser.uid}/starred`), value => {
            const list = Array.isArray(value) ? value : [];
            return list.some(q => sameStar(q, entry)) ? list.filter(q => !sameStar(q, entry)) : [...list, entry];
        }, { applyLocally: false });
        const list = Array.isArray(result.snapshot.val()) ? result.snapshot.val() : [];
        userStarredCache = list;
        if (currentQuestion === question) setStarState(list.some(q => sameStar(q, entry)));
    } catch (error) { showCustomAlert('收藏未儲存，請重試。'); }
    finally { starBtn.disabled = false; }
}

function openErrataModal() {
    if (!currentQuestion || !currentQuestion.question) {
        showCustomAlert('當前沒有可用的題目！');
        return;
    }

    // Clear and open
    errataFormContainer.innerHTML = '';
    errataModal.style.display = 'flex';

    if (currentQuestion.isFillBlank) {
        const currentVal = Array.isArray(currentQuestion.answer)
            ? currentQuestion.answer.join(',')
            : (currentQuestion.answer || '');

        const wrapper = document.createElement('div');
        wrapper.className = 'md3-input-wrapper';
        wrapper.innerHTML = `
            <input type="text" id="errataFillBlankInput" class="md3-input" placeholder=" " value="${currentVal}">
            <label for="errataFillBlankInput" class="md3-floating-label">正確答案關鍵字</label>
        `;
        errataFormContainer.appendChild(wrapper);

        const hint = document.createElement('p');
        hint.style.cssText = 'font-size: 0.85rem; color: #5f6368; margin: 8px 0 0 0; line-height: 1.4;';
        hint.innerHTML = '如果是多個關鍵字，請以半角逗號 (<code>,</code>) 分隔，系統將會比對使用者輸入是否包含這些關鍵字。';
        errataFormContainer.appendChild(hint);
    } else if (currentQuestion.isMultiSelect) {
        const list = document.createElement('div');
        list.className = 'errata-options-list';
        const currentAnsList = Array.isArray(currentQuestion.answer) ? currentQuestion.answer : [currentQuestion.answer];

        getOrderedOptionEntries(currentQuestion.options).forEach(([key, value]) => {
            const label = document.createElement('label');
            label.className = 'errata-option-item';
            if (currentAnsList.includes(key)) {
                label.classList.add('selected');
            }
            label.innerHTML = `
                <input type="checkbox" name="errataOption" value="${key}" ${currentAnsList.includes(key) ? 'checked' : ''}>
                <span>${key}: ${value}</span>
            `;

            const checkbox = label.querySelector('input');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    label.classList.add('selected');
                } else {
                    label.classList.remove('selected');
                }
            });
            list.appendChild(label);
        });
        errataFormContainer.appendChild(list);
    } else {
        const list = document.createElement('div');
        list.className = 'errata-options-list';
        const currentAns = currentQuestion.answer;

        getOrderedOptionEntries(currentQuestion.options).forEach(([key, value]) => {
            const label = document.createElement('label');
            label.className = 'errata-option-item';
            if (currentAns === key) {
                label.classList.add('selected');
            }
            label.innerHTML = `
                <input type="radio" name="errataOption" value="${key}" ${currentAns === key ? 'checked' : ''}>
                <span>${key}: ${value}</span>
            `;

            const radio = label.querySelector('input');
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    list.querySelectorAll('.errata-option-item').forEach(item => item.classList.remove('selected'));
                    label.classList.add('selected');
                }
            });
            list.appendChild(label);
        });
        errataFormContainer.appendChild(list);
    }
}

async function saveErrataAnswer() {
    const target = currentQuestion;
    if (!target) return;

    let newAns;

    if (target.isFillBlank) {
        const inputVal = document.getElementById('errataFillBlankInput').value.trim();
        if (!inputVal) {
            showCustomAlert('答案關鍵字不能為空！');
            return;
        }
        if (inputVal.includes(',')) {
            newAns = inputVal.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            newAns = inputVal;
        }
    } else if (target.isMultiSelect) {
        const checked = Array.from(errataFormContainer.querySelectorAll('input[name="errataOption"]:checked'));
        if (checked.length === 0) {
            showCustomAlert('請至少選擇一個選項！');
            return;
        }
        newAns = checked.map(el => el.value);
    } else {
        const checked = errataFormContainer.querySelector('input[name="errataOption"]:checked');
        if (!checked) {
            showCustomAlert('請選擇一個選項！');
            return;
        }
        newAns = checked.value;
    }

    // 1. Map new standard answers back to database format if reverseLabelMapping exists
    let databaseAns = newAns;
    if (target.reverseLabelMapping) {
        if (Array.isArray(newAns)) {
            databaseAns = newAns.map(val => target.reverseLabelMapping[val] || val);
        } else {
            databaseAns = target.reverseLabelMapping[newAns] || newAns;
        }
    }

    let origIdx = target.originalIndex;
    if (origIdx === undefined || origIdx === -1) {
        if (questions && questions.length > 0) {
            origIdx = questions.findIndex(origQ => origQ.question === target.question);
        }
    }

    if (origIdx === undefined || origIdx === -1) {
        showCustomAlert('無法找到該題目在資料庫的索引！');
        return;
    }
    target.originalIndex = origIdx;

    try {
        // 2. Save to Firebase
        const sourcePath = target.sourcePath || selectedJson;
        const result = await runTransaction(ref(database, `${sourcePath}/${origIdx}`), value => {
            if (!value || value.question !== target.question) return;
            return { ...value, answer: databaseAns, revision: (value.revision || 1) + 1, history: { ...value.history, [value.revision || 1]: { answer: value.answer, explanation: value.explanation || '', revisedAt: Date.now() } } };
        }, { applyLocally: false });
        if (!result.committed) { showCustomAlert('題庫內容已變更，請重新載入後再勘誤。'); return; }

        // 3. Update local state
        target.answer = newAns;
        target.revision = result.snapshot.val().revision;
        if (sourcePath === selectedJson && questions?.[origIdx]?.question === target.question) questions[origIdx].answer = databaseAns;

        // 4. Recalculate correctness if user has already answered this question
        recalculateCorrectness(target);

        showCustomAlert('已更新題庫答案。');
        const key = target.mistakeQuizKey || getQuizStorageName(sourcePath);
        const mistake = flattenMistakes(userMistakesCache).find(m => m.quizKey === key && m.question === target.question);
        if (mistake && auth.currentUser) {
            try {
                const record = await runTransaction(ref(database, `mistakes/${auth.currentUser.uid}/${key}/${mistake.recordPath}`), value => value ? {
                    ...value, ...canonicalQuestion(target), sourcePath, status: 'active', correctStreak: 0, lastResult: 'corrected'
                } : undefined, { applyLocally: false });
                if (record.committed) cacheMistake(key, mistake.recordPath, record.snapshot.val());
            } catch (error) { showCustomAlert('題庫答案已更新，錯題紀錄尚未同步。'); }
        }
        errataModal.style.display = 'none';

        // 5. Re-render question to update UI classes & colors
        if (currentQuestion === target) renderQuestion(viewingIndex);
    } catch (error) {
        console.error('儲存勘誤失敗:', error);
        showCustomAlert('儲存失敗，請確認您是否擁有該題庫的寫入權限。');
    }
}

function recalculateCorrectness(q) {
    if (!q.isConfirmed && !q.isAnswered) return;

    const wasCorrect = q.isCorrect;

    if (q.isFillBlank) {
        const sentence = (q.userSelection || '').toLowerCase();
        const required = Array.isArray(q.answer) ? q.answer : [q.answer];
        const allMatch = required.every(keyword => sentence.includes(keyword.toLowerCase()));
        q.isCorrect = allMatch;
    } else if (q.isMultiSelect) {
        const userSel = q.userSelection || [];
        const isCompletelyCorrect = (userSel.length === q.answer.length) &&
            q.answer.every(opt => userSel.includes(opt));
        q.isCorrect = isCompletelyCorrect;
    } else {
        q.isCorrect = q.userSelection === q.answer;
    }

    if (wasCorrect !== q.isCorrect) {
        if (q.isCorrect) {
            correct += 1;
            wrong = Math.max(0, wrong - 1);
        } else {
            correct = Math.max(0, correct - 1);
            wrong += 1;
        }
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;
        saveProgress();
    }
}

async function openCollectionPage() {
    try { await collection.open(); } catch (error) { showCustomAlert(error.message); }
}

if (starBtn) starBtn.addEventListener('click', toggleStarCurrentQuestion);
if (showStarredBtn) showStarredBtn.addEventListener('click', openCollectionPage);
// ========== 深色模式功能 ==========

// 深色模式相關變數
let isDarkMode = false;
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');

// 檢查系統深色模式偏好
function getSystemThemePreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 從 localStorage 加載主題設定
function loadThemePreference() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        isDarkMode = savedTheme === 'dark';
    } else {
        // 預設為淺色模式，不再自動跟隨系統深色模式偏好
        isDarkMode = false;
    }
    applyTheme();
}

// 應用主題
function updateMenuThemeLabel() {
    if (typeof menuTheme !== 'undefined' && menuTheme) {
        const label = menuTheme.querySelector('.item-label');
        if (label) label.textContent = isDarkMode ? '淺色模式' : '深色模式';
    }
}

function applyTheme() {
    if (isDarkMode) {
        document.documentElement.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
    }
    // 儲存主題設定到 localStorage
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    updateMenuThemeLabel();
}

// 切換主題
function toggleTheme() {
    isDarkMode = !isDarkMode;
    applyTheme();
}

// 監聽系統主題變化
function watchSystemTheme() {
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', (e) => {
            // 只有在沒有手動設定主題時才跟隨系統
            if (!localStorage.getItem('theme')) {
                isDarkMode = e.matches;
                applyTheme();
            }
        });
    }
}

// 初始化主題功能
function initTheme() {
    loadThemePreference();
    // 預設不自動跟隨系統深色模式，因此不呼叫 watchSystemTheme()

    // 綁定切換按鈕事件
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }
}

// 頁面載入完成後初始化主題
document.addEventListener('DOMContentLoaded', initTheme);


/* Notebook integration. Practice reuses the existing answering interface. */
const mistakeView = document.getElementById('mistakeView');
let notebook;

function closeMistakeView() { notebook.close(); }
function openMistakeView(quizName = null) {
    if (!auth.currentUser) { showCustomAlert('登入後即可使用錯題本。'); return; }
    notebook.open(quizName);
}
function cacheMistake(quizKey, path, value) {
    let target = userMistakesCache[quizKey] ||= {};
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = value;
}
function recordAttempt(isCorrect) {
    if (!auth.currentUser || !currentQuestion?.question || !selectedJson) return;
    const q = normalizeQuestion(structuredClone(currentQuestion), currentQuestion.sourcePath || selectedJson, currentQuestion.originalIndex);
    const sourcePath = q.sourcePath || selectedJson;
    const quizKey = q.mistakeQuizKey || getQuizStorageName(sourcePath);
    const existing = flattenMistakes(userMistakesCache).find(m => m.questionId === q.questionId || (m.quizKey === quizKey && m.question === q.question));
    const recordPath = q.mistakeRecordPath || existing?.recordPath || q.questionId;
    const snapshot = { ...canonicalQuestion(q), questionId: q.questionId, revision: q.revision, taxonomy: q.taxonomy, sourcePath };
    const event = { eventId: `${sessionId}_${q.questionId}`, questionId: q.questionId, questionRevision: q.revision, sessionId,
        selectedAnswer: snapshot.lastSelection, isCorrect, responseTimeMs: q.responseTimeMs || 0,
        mode: sessionMode, usedAI: !!q.usedAI, changedAnswer: !!q.changedAnswer, submittedAt: Date.now(), sourcePath, taxonomy: q.taxonomy };
    const optimistic = applyAttempt(existing, snapshot, { correct: isCorrect, eventId: event.eventId, now: event.submittedAt });
    if (optimistic) cacheMistake(quizKey, recordPath, optimistic);
    recordLearning({ event, snapshot, quizKey, recordPath }).catch(() => showCustomAlert('無法保存作答紀錄，請檢查瀏覽器儲存空間。'));
}

notebook = createNotebook({
    root: mistakeView, getCache: () => userMistakesCache,
    refresh: async () => {
        const uid = auth.currentUser?.uid;
        await flushOutbox();
        const [mistakesSnap, starredSnap] = await Promise.all([
            get(ref(database, `mistakes/${uid}`)),
            get(ref(database, `progress/${uid}/starred`))
        ]);
        if (auth.currentUser?.uid === uid) {
            userMistakesCache = mistakesSnap.val() || {};
            userStarredCache = Array.isArray(starredSnap.val()) ? starredSnap.val() : [];
        }
    },
    setStatus: async (m, status) => {
        const uid = auth.currentUser.uid;
        const result = await runTransaction(ref(database, `mistakes/${uid}/${m.quizKey}/${m.recordPath}`), value => value ? {
            ...value, status, correctStreak: status === 'active' ? 0 : value.correctStreak || 0, statusUpdated: Date.now()
        } : undefined, { applyLocally: false });
        if (result.committed && auth.currentUser?.uid === uid) cacheMistake(m.quizKey, m.recordPath, result.snapshot.val());
    },
    isStarred: m => {
        const source = getQuizStorageName(m.sourcePath || m.quizKey || m.origin || '');
        return userStarredCache.some(q => sameStar(q, { question: m.question, questionId: m.questionId, source }));
    },
    toggleStar: async m => {
        const uid = auth.currentUser?.uid;
        if (!uid) throw new Error('請先登入。');
        const source = getQuizStorageName(m.sourcePath || m.quizKey || m.origin || '');
        const entry = { ...canonicalQuestion(m), questionId: m.questionId || null, source };
        const result = await runTransaction(ref(database, `progress/${uid}/starred`), value => {
            const list = Array.isArray(value) ? value : [];
            return list.some(q => sameStar(q, entry)) ? list.filter(q => !sameStar(q, entry)) : [...list, entry];
        }, { applyLocally: false });
        const list = Array.isArray(result.snapshot.val()) ? result.snapshot.val() : [];
        if (auth.currentUser?.uid === uid) userStarredCache = list;
        const isNowStarred = list.some(q => sameStar(q, entry));
        if (currentQuestion) {
            const curSource = getQuizStorageName(currentQuestion.sourcePath || selectedJson);
            if (sameStar({ ...currentQuestion, source: curSource }, entry)) setStarState(isNowStarred);
        }
        return isNowStarred;
    },
    makeCards: items => vocabulary.generate(items),
    practice: startMistakePractice, renderMath: renderLatex, alert: showCustomAlert
});

async function startMistakePractice(items) {
    if (!items.length) return;
    sessionId = crypto.randomUUID(); sessionMode = 'study';
    document.body.classList.remove('exam-active');
    const sourceKeys = [...new Set(items.map(m => m.sourcePath || m.quizKey))];
    const sources = new Map();
    // Fetch each bank once; a removed bank can still be reviewed from its saved snapshot.
    await Promise.all(sourceKeys.map(async key => {
        const resolved = catalogPaths.find(p => getQuizStorageName(p) === getQuizStorageName(key)) || key;
        try { const snap = await get(ref(database, resolved)); if (Array.isArray(snap.val())) sources.set(key, { path: resolved, questions: snap.val() }); }
        catch (error) { console.warn('Using saved question', key, error); }
    }));
    allQuestions = items.map(m => {
        const source = sources.get(m.sourcePath || m.quizKey);
        const stableIndex = m.questionId ? source?.questions.findIndex(q => q.questionId === m.questionId) : -1;
        const index = stableIndex >= 0 ? stableIndex : source?.questions[m.originalIndex]?.question === m.question ? m.originalIndex : source?.questions.findIndex(q => q.question === m.question) ?? -1;
        const prep = preparePractice({ ...m, sourcePath: source?.path || m.sourcePath || m.quizKey, originalIndex: index }, index >= 0 ? source.questions[index] : null);
        if (prep.options) prep.options = normalizeQuestionOptions(prep.options);
        else delete prep.options;
        return prep;
    });
    selectedJson = allQuestions[0].sourcePath;
    questions = sources.get(items[0].sourcePath || items[0].quizKey)?.questions || [];
    wrongQuestions = []; correct = 0; wrong = 0; currentIndex = 0; viewingIndex = 0;
    selectedOption = null; selectedOptions = []; initialQuestionCount = allQuestions.length;
    document.getElementById('correct').innerText = 0;
    document.getElementById('wrong').innerText = 0;
    isTestCompleted = false; isMistakePracticeMode = true;
    if (endScreenDiv) endScreenDiv.remove();
    closeMistakeView();
    document.querySelector('.start-screen').style.display = 'none';
    quizContainer.style.display = 'flex';
    document.querySelector('.quiz-title').innerText = '錯題複習';
    document.title = '錯題複習 - 題矣';
    createProgressDots(); renderQuestion(0);
}

let currentQuizDedupResult = null;
let quizDedupCheckToken = 0;

async function openQuizActionModal(key, progress) {
    if (!learningDataReady) {
        await fetchUserProgressAndMistakes(auth.currentUser);
        if (!learningDataReady) return;
        progress = userProgressCache[getQuizStorageName(key)];
    }
    const modal = document.getElementById('quizActionModal');
    const title = document.getElementById('quizActionTitle');
    const status = document.getElementById('quizActionStatus');
    const resumeBtn = document.getElementById('quizActionResumeBtn');
    const restartBtn = document.getElementById('quizActionRestartBtn');
    const filterSection = document.getElementById('quizActionFilterSection');
    const skipCheckbox = document.getElementById('skipPastExamRepeatsCheckbox');
    const filterInfo = document.getElementById('quizActionFilterInfo');

    if (!modal) return;

    currentQuizDedupResult = null;
    const currentToken = ++quizDedupCheckToken;

    const label = quizLabel(key);
    title.textContent = label.title;
    document.getElementById('quizActionSubject').textContent = label.subject;
    const total = progress?.allQuestions?.length || catalogData[key]?.count || 0;
    const answered = progress?.allQuestions ? progress.allQuestions.filter(q => q.isAnswered).length : progress?.currentIndex || 0;
    const done = Math.min(total, answered);
    const showResume = !!progress && (done > 0 || progress.allQuestions?.length > 0);
    const complete = total > 0 && done >= total;
    status.textContent = complete ? '已完成' : showResume ? '上次進度' : '題目數';
    document.getElementById('quizActionCount').textContent = showResume ? `${done} / ${total} 題` : `${total} 題`;
    document.getElementById('quizActionTrack').hidden = !showResume;
    document.getElementById('quizActionFill').style.width = `${total ? done / total * 100 : 0}%`;
    document.getElementById('quizActionOrder').textContent = showResume
        ? complete ? '可查看本次作答，或重新練習。' : '從上次作答的位置繼續。'
        : shouldShuffleQuiz ? '隨機題序與選項' : '依題庫順序作答';
    resumeBtn.hidden = !showResume;
    resumeBtn.style.display = showResume ? 'flex' : 'none';
    resumeBtn.querySelector('span').textContent = complete ? '查看作答紀錄' : '繼續測驗';
    resumeBtn.onclick = () => {
        closeQuizActionModal(); selectedJson = key; restoreProgress(getQuizStorageName(key));
    };
    restartBtn.className = showResume ? 'secondary-button' : 'primary-button';
    restartBtn.querySelector('span').textContent = showResume ? '重新開始' : '開始測驗';
    restartBtn.querySelector('span:last-child').hidden = showResume;
    restartBtn.onclick = () => {
        const isSkipping = skipCheckbox && skipCheckbox.checked && currentQuizDedupResult && currentQuizDedupResult.nonRepeatedQuestions;
        const dedupData = currentQuizDedupResult;
        closeQuizActionModal();
        if (isSkipping) {
            startDedupQuiz(key, dedupData);
        } else {
            startFreshQuiz(key);
        }
    };

    const applyDedupMode = (isSkipping) => {
        if (isSkipping && currentQuizDedupResult) {
            const nrCount = currentQuizDedupResult.nonRepeatedCount;
            status.textContent = '非考古題';
            document.getElementById('quizActionCount').textContent = `${nrCount} 題`;
            document.getElementById('quizActionTrack').hidden = true;
            document.getElementById('quizActionOrder').textContent = `已排除 ${currentQuizDedupResult.rangeStr} 重複題目，共 ${nrCount} 題。`;
            resumeBtn.hidden = true;
            resumeBtn.style.display = 'none';
            restartBtn.className = 'primary-button';
            restartBtn.querySelector('span').textContent = '開始測驗';
            restartBtn.querySelector('span:last-child').hidden = false;
        } else {
            status.textContent = complete ? '已完成' : showResume ? '上次進度' : '題目數';
            document.getElementById('quizActionCount').textContent = showResume ? `${done} / ${total} 題` : `${total} 題`;
            document.getElementById('quizActionTrack').hidden = !showResume;
            document.getElementById('quizActionOrder').textContent = showResume
                ? complete ? '可查看本次作答，或重新練習。' : '從上次作答的位置繼續。'
                : shouldShuffleQuiz ? '隨機題序與選項' : '依題庫順序作答';
            resumeBtn.hidden = !showResume;
            resumeBtn.style.display = showResume ? 'flex' : 'none';
            resumeBtn.querySelector('span').textContent = complete ? '查看作答紀錄' : '繼續測驗';
            restartBtn.className = showResume ? 'secondary-button' : 'primary-button';
            restartBtn.querySelector('span').textContent = showResume ? '重新開始' : '開始測驗';
            restartBtn.querySelector('span:last-child').hidden = showResume;
        }
    };

    if (filterSection && skipCheckbox && filterInfo) {
        skipCheckbox.checked = false;
        skipCheckbox.disabled = true;
        skipCheckbox.onchange = () => {
            applyDedupMode(skipCheckbox.checked);
        };

        const subsequent = findSubsequentQuizzes(key, catalogPaths);
        if (!subsequent || subsequent.length === 0) {
            filterSection.style.display = 'none';
        } else {
            filterSection.style.display = 'block';
            filterInfo.textContent = '比對後續年份中…';

            getPastExamComparisonInfo(key, catalogPaths, readBank)
                .then(result => {
                    if (currentToken !== quizDedupCheckToken) return;
                    currentQuizDedupResult = result;
                    if (!result.hasLaterExams || result.laterKeys.length === 0) {
                        filterSection.style.display = 'none';
                        return;
                    }

                    if (result.nonRepeatedCount === 0) {
                        filterInfo.textContent = `無非考古題（全卷皆在 ${result.rangeStr} 重複出現）`;
                        skipCheckbox.disabled = true;
                    } else {
                        filterInfo.textContent = `非考古題共 ${result.nonRepeatedCount} 題（比對 ${result.rangeStr}）`;
                        skipCheckbox.disabled = false;
                    }

                    if (skipCheckbox.checked) {
                        applyDedupMode(true);
                    }
                })
                .catch(err => {
                    if (currentToken !== quizDedupCheckToken) return;
                    console.error('Failed to compute exam dedup info:', err);
                    filterSection.style.display = 'none';
                });
        }
    }

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    (showResume ? resumeBtn : restartBtn).focus();
}

function closeQuizActionModal() {
    const modal = document.getElementById('quizActionModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
    currentQuizDedupResult = null;
    quizDedupCheckToken++;
    const skipCheckbox = document.getElementById('skipPastExamRepeatsCheckbox');
    if (skipCheckbox) {
        skipCheckbox.checked = false;
        skipCheckbox.disabled = true;
        skipCheckbox.onchange = null;
    }
}

function startDedupQuiz(key, dedupResult) {
    if (!learningDataReady) { showCustomAlert('學習紀錄尚未載入，請重新整理後再試。'); return; }
    isMistakePracticeMode = false;
    selectedJson = key;
    customSession = {
        questions: dedupResult.nonRepeatedQuestions,
        mode: 'study',
        shuffleOptions: false,
        timeLimit: 0,
        isSkipRepeatMode: true,
        compareRange: dedupResult.rangeStr
    };
    initQuiz().catch(error => {
        selectedJson = null;
        document.querySelector('.start-screen').style.display = 'flex';
        showCustomAlert('題庫載入失敗，請重試。');
        console.error(error);
    });
}

function startFreshQuiz(key) {
    if (!learningDataReady) { showCustomAlert('學習紀錄尚未載入，請重新整理後再試。'); return; }
    isMistakePracticeMode = false;
    selectedJson = key;
    initQuiz().catch(error => {
        selectedJson = null;
        document.querySelector('.start-screen').style.display = 'flex';
        showCustomAlert('題庫載入失敗，請重試。');
        console.error(error);
    });
}

async function fetchUserProgressAndMistakes(user) {
    learningDataReady = false;
    await loadLearning();
    if (!user) {
        userProgressCache = {};
        userMistakesCache = {};
        return;
    }
    try {
        const oldProgressSnap = await get(ref(database, `progress/${user.uid}/progress`));
        if (oldProgressSnap.exists()) {
            const oldVal = oldProgressSnap.val();
            if (oldVal && oldVal.selectedJson) {
                const quizName = getQuizStorageName(oldVal.selectedJson);
                await set(ref(database, `progress/${user.uid}/quizzes/${quizName}`), oldVal);
                await set(ref(database, `progress/${user.uid}/lastActive`), {
                    quizName,
                    selectedJson: oldVal.selectedJson,
                    lastUpdated: Date.now()
                });
                await remove(ref(database, `progress/${user.uid}/progress`));
                console.log(`Legacy progress migrated for quiz: ${quizName}`);
            }
        }

        const [progressSnap, mistakesSnap, starredSnap] = await Promise.all([
            get(ref(database, `progress/${user.uid}/quizzes`)),
            get(ref(database, `mistakes/${user.uid}`)),
            get(ref(database, `progress/${user.uid}/starred`))
        ]);

        if (auth.currentUser?.uid !== user.uid) return;
        userProgressCache = progressSnap.exists() ? progressSnap.val() : {};
        userMistakesCache = mistakesSnap.exists() ? mistakesSnap.val() : {};
        userStarredCache = Array.isArray(starredSnap.val()) ? starredSnap.val() : [];
        for (const item of await storage('cache', 'getAll')) if (item.uid === user.uid && item.quizKey && (!userProgressCache[item.quizKey] || userProgressCache[item.quizKey].lastUpdated < item.value.lastUpdated)) userProgressCache[item.quizKey] = item.value;
        learningDataReady = true;
        window.dispatchEvent(new Event('teah-auth-ready'));
    } catch (e) {
        if (auth.currentUser?.uid !== user.uid) return;
        console.error('Failed to fetch user progress/mistakes cache:', e);
        userProgressCache = {}; userMistakesCache = {};
        for (const item of await storage('cache', 'getAll')) if (item.uid === user.uid && item.quizKey) userProgressCache[item.quizKey] = item.value;
        learningDataReady = Object.keys(userProgressCache).length > 0;
        showCustomAlert(learningDataReady ? '目前使用此裝置的離線進度。' : '學習紀錄載入失敗，請恢復連線後重試。');
    }
}


const quizActionCloseBtn = document.getElementById('quizActionCloseBtn');
if (quizActionCloseBtn) quizActionCloseBtn.addEventListener('click', () => {
    closeQuizActionModal();
});


// Home shortcuts keep frequently used collections out of the account menu.
document.getElementById('homeMistakes').onclick = () => openMistakeView();
document.getElementById('homeStarred').onclick = () => openCollectionPage();
const unitsGrid = document.getElementById('units-grid');
const bankLibrary = mountBankLibrary({
    grid: unitsGrid, navigation: document.getElementById('folder-breadcrumb'), input: document.getElementById('bankSearch'),
    getUser: () => auth.currentUser?.uid,
    getProgress: key => userProgressCache[key], getStorageKey: getQuizStorageName,
    onFolder: folder => { currentActiveFolder = folder; },
    onOpen: key => openQuizActionModal(key, userProgressCache[getQuizStorageName(key)]),
    onManage: managing => { const label = menuEditQuizName?.querySelector('.item-label'); if (label) label.textContent = managing ? '完成管理' : '編輯題庫'; },
    refreshSearch: () => questionSearch.refresh(),
    onChanged: async changes => {
        if (selectedJson && changes[selectedJson] === null) selectedJson = null;
        await fetchQuizList();
        await updateRestorePreview(auth.currentUser);
    }
});
document.getElementById('libraryAdd').onclick = () => openUploadModal('paste');
const questionSearch = mountQuestionSearch({
    input: document.getElementById('bankSearch'), host: document.getElementById('questionSearch'), readBank,
    getUser: () => auth.currentUser?.uid, getScope: () => libraryPage, renderMath: renderLatex,
    filterBanks: query => bankLibrary.filter(query),
    practice: async q => {
        customSession = { questions: [q], mode: 'study', shuffleOptions: false, timeLimit: 0 }; selectedJson = q.sourcePath;
        await initQuiz(); document.querySelector('.quiz-title').textContent = '搜尋練習';
    }
});

function returnHome() {
    stopTimer();
    document.body.classList.remove('exam-active');
    quizContainer.style.display = 'none';
    endScreenDiv?.remove();
    document.querySelector('.start-screen').style.display = 'flex';
    selectedJson = null;
    document.title = '題矣';
    if (libraryPage === 'collection') openCollectionPage();
    document.getElementById('bankSearch').value = libraryLocations[libraryPage].query || '';
    updateRestorePreview(auth.currentUser);
    fetchQuizList().then(() => window.scrollTo(0, libraryLocations[libraryPage].scroll));
}
const quizTitleLink = document.querySelector('.quiz-title');
quizTitleLink.setAttribute('role', 'button');
quizTitleLink.tabIndex = 0;
quizTitleLink.title = '返回題庫';
quizTitleLink.setAttribute('aria-label', '返回題庫');
quizTitleLink.addEventListener('click', returnHome);
quizTitleLink.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); returnHome(); }
});

installDialogBehavior();

mountLearningHub({ getCatalog: () => catalogData, alert: showCustomAlert, current: () => currentQuestion,
    start: async (items, mode, options) => {
        customSession = { questions: items, mode, ...options }; selectedJson = items[0].sourcePath;
        await initQuiz(); document.querySelector('.quiz-title').textContent = mode === 'exam' ? '自訂測驗 · 考試' : '自訂測驗 · 學習';
    }
});

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

mountEditorial();

const menuArchive = document.getElementById('menuArchive');
if (menuArchive) menuArchive.onclick = () => showLibraryPage('archive');
document.getElementById('homeArchive').onclick = () => showLibraryPage('archive');
document.getElementById('homeLibrary').onclick = () => showLibraryPage('library');
document.getElementById('homeLibrary').setAttribute('aria-current', 'page');
const collection = createCollection({
    host: document.getElementById('collectionPage'), getSourceLabel: source => (catalogPaths.find(p => getQuizStorageName(p) === source) || source || '').replace(/^_Archive_/, ''), activate: () => showLibraryPage('collection'), renderMath: renderLatex,
    onRemove: q => { if (currentQuestion && sameStar(q, { ...currentQuestion, source: getQuizStorageName(currentQuestion.sourcePath || selectedJson) })) setStarState(false); },
    practice: async entries => {
        const uid = auth.currentUser?.uid;
        const banks = new Map();
        await Promise.all([...new Set(entries.map(q => q.source))].map(async source => {
            const path = catalogPaths.find(p => getQuizStorageName(p) === source) || source;
            try { banks.set(source, { path, rows: await readBank(path) }); } catch { banks.set(source, { path, rows: [] }); }
        }));
        if (!uid || uid !== auth.currentUser?.uid) throw new Error('帳戶已切換，請重新開啟收藏。');
        const items = entries.map(q => {
            const bank = banks.get(q.source);
            const byId = q.questionId ? bank.rows.findIndex(row => row.questionId === q.questionId) : -1;
            const index = byId >= 0 ? byId : bank.rows.findIndex(row => row.question === q.question);
            return { ...normalizeQuestion(index >= 0 ? bank.rows[index] : q, bank.path || '收藏', Math.max(0, index)), sourcePath: bank.path || '收藏', originalIndex: index };
        });
        customSession = { questions: items, mode: 'study', shuffleOptions: false, timeLimit: 0 }; selectedJson = items[0].sourcePath;
        await initQuiz(); document.querySelector('.quiz-title').textContent = '收藏練習';
    }
});
const vocabulary = mountFlashcard({ host: document.getElementById('flashcardPage'), activate: () => {
    if (mistakeView.style.display === 'flex') closeMistakeView();
    showLibraryPage('flashcard');
} });
document.getElementById('tabLibrary')?.addEventListener('click', () => showLibraryPage('library'));
document.getElementById('tabFlashcard')?.addEventListener('click', () => vocabulary.open());
mountSidebar();
