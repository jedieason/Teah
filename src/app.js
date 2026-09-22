import { mountSidebar } from './shared/sidebar.js';
import { createFlashcards } from './features/flashcards/view.js';
import { mountEditorial } from './features/learning/editorial.js';
import { normalizeQuestion } from './features/learning/model.js';
import { loadLearning, recordLearning, readBank } from './services/learning.js';
import { enqueue, flushOutbox, storage } from './services/outbox.js';
import { mountLearningHub } from './features/learning/hub.js';
import { mountConceptReview } from './features/concept-review/view.js';
import { installDialogBehavior } from './shared/dialogs.js';
import { readCatalog, writeBanks, validBankName } from './services/catalog.js';
import { database, auth, googleProvider, ref, get, update, set, remove, runTransaction, signInWithPopup, onAuthStateChanged, signOut } from './services/firebase.js';
import { flattenMistakes, canonicalQuestion, applyAttempt, preparePractice, quizLabel } from './features/mistakes/model.js';
import { createNotebook } from './features/mistakes/notebook.js';
import { markdown, validateQuiz } from './shared/content.js';
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
    sessionId = crypto.randomUUID();
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

            q.options = newOptions;
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
    document.querySelector('.quiz-title').innerText = `${fileName}`;
    document.title = `${fileName} - 題矣`;

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

    if (currentQuestion !== q) questionStartedAt = Date.now();
    currentQuestion = q; // Update currentQuestion globally

    const confirmBtn = document.getElementById('confirm-btn');
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-progress-btn');
    const backBtnExpl = document.getElementById('back-progress-btn-expl');

    document.getElementById('WeeGPTInputSection').style.display = 'none';
    updateStarIcon();

    const questionDiv = document.getElementById('question');
    const questionHtml = markdown(q.question);
    if (q.isMultiSelect) {
        const labelText = q.isFillBlank ? '句' : '多';
        questionDiv.innerHTML = `
            <div class="question-wrapper">
                <div class="multi-label">${labelText}</div>
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
            if (q.isCorrect) {
                fillblankInput.classList.add('correct');
            } else {
                fillblankInput.classList.add('incorrect');
            }
        } else if (index === currentIndex) {
            fillblankInput.disabled = false;
        }
    } else {
        optionsContainer.style.display = 'flex';
        fillblankContainer.style.display = 'none';
        optionsContainer.innerHTML = '';

        Object.entries(q.options).forEach(([key, value]) => {
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
        document.getElementById('explanation-text').innerHTML = revealAnswer ? markdown(q.explanation || '尚無詳解') : '';
        renderLatex(document.getElementById('explanation-text'));
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

// 修改確認按鈕函數
// 修改確認按鈕函數
function confirmAnswer() {
    const active = allQuestions[currentIndex];
    if (active && !active.isAnswered) active.responseTimeMs = Math.max(0, Date.now() - questionStartedAt);
    const q = allQuestions[currentIndex];
    if (!q || q.isAnswered || viewingIndex !== currentIndex) return;

    if (q.isFillBlank) {
        const userInput = fillblankInput.value.trim();
        if (!userInput) {
            showCustomAlert('請輸入您的答案！');
            return;
        }
        stopTimer();

        const sentence = userInput.toLowerCase();
        const required = Array.isArray(q.answer) ? q.answer : [q.answer];
        const allMatch = required.every(keyword => sentence.includes(keyword.toLowerCase()));

        q.isCorrect = allMatch;
        q.userSelection = userInput;
        q.isAnswered = true;
        q.isConfirmed = true;

        if (allMatch) {
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
    redoBtn.addEventListener('click', () => {
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
        const wasPractice = isMistakePracticeMode;
        returnHome();
        if (wasPractice) openMistakeView();
    });
    actionArea.appendChild(resetBtn);

    container.appendChild(actionArea);
    endScreenDiv.appendChild(container);

    quizContainer.parentNode.appendChild(endScreenDiv);
    mountConceptReview(container, {
        questions: allQuestions, source: selectedJson,
        getKey: async () => (await get(ref(database, 'API_KEY'))).val()
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
    for (let [optionKey, optionText] of Object.entries(currentQuestion.options)) {
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

        if (!isConfirmed) {
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

// 從 Firebase 讀取可用的題庫清單並建立按鈕
async function fetchQuizList() {
    try {
        const data = await readCatalog();
        catalogData = data;
        catalogPaths = Object.keys(data);
        const snapshot = { exists: () => catalogPaths.length > 0, val: () => data };
        // Target new grid container
        const gridContainer = document.getElementById('units-grid');
        const breadcrumbContainer = document.getElementById('folder-breadcrumb');

        if (gridContainer) gridContainer.innerHTML = '';

        if (snapshot.exists()) {
            const data = snapshot.val();
            const allKeys = Object.keys(data || {});

            // Track all archived quiz keys globally
            globalArchivedQuizKeys.clear();
            allKeys.forEach(k => {
                if (k.startsWith('_Archive_')) {
                    globalArchivedQuizKeys.add(getQuizStorageName(k));
                }
            });

            const quizKeys = allKeys.filter(k => k !== 'progress' && k !== 'API_KEY' && k !== 'mistakes' && k !== 'mistake' && (viewArchiveMode ? k.startsWith('_Archive_') : !k.startsWith('_Archive_')));
            const groups = {};
            quizKeys.forEach(k => {
                let cleanKey = k;
                if (cleanKey.startsWith('_Archive_')) cleanKey = cleanKey.substring(9);
                const idx = cleanKey.indexOf('｜');
                const groupName = idx !== -1 ? cleanKey.slice(0, idx) : '其他';
                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(k);
            });
            globalQuizGroups = groups;

            const sortGroups = (names) => names.sort((a, b) => {
                if (a === '其他' && b !== '其他') return 1;
                if (b === '其他' && a !== '其他') return -1;
                return a.localeCompare(b, 'zh-Hant');
            });

            const renderFolderTiles = () => {
                currentActiveFolder = null;
                if (gridContainer) {
                    gridContainer.innerHTML = '';
                    gridContainer.className = 'units-grid' + (isEditMode ? ' edit-mode' : ''); // Reset class but keep edit-mode if active
                }

                sortGroups(Object.keys(groups)).forEach(groupName => {
                    const count = (groups[groupName] || []).length;

                    // Create Unit Card
                    const card = document.createElement('div');
                    card.className = 'unit-card';

                    const iconBox = document.createElement('div');
                    iconBox.className = 'unit-icon-box';
                    iconBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>';

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'unit-info';

                    const title = document.createElement('div');
                    title.className = 'unit-title';
                    title.textContent = groupName;

                    const subtitle = document.createElement('div');
                    subtitle.className = 'unit-subtitle';
                    subtitle.textContent = `${count} 份習題`;

                    infoDiv.appendChild(title);
                    infoDiv.appendChild(subtitle);

                    card.appendChild(iconBox);
                    card.appendChild(infoDiv);

                    card.onclick = () => {
                        if (!auth.currentUser) {
                            showCustomAlert('請先登入後再開始測驗！');
                            return;
                        }
                        renderFolderView(groupName);
                    };

                    gridContainer.appendChild(card);
                });

                if (breadcrumbContainer) breadcrumbContainer.innerHTML = ''; // Clear header in tile view
            };

            const renderFolderView = (groupName) => {
                currentActiveFolder = groupName;
                document.getElementById('bankSearch').value = '';
                if (gridContainer) gridContainer.innerHTML = '';

                // Render Breadcrumb
                if (breadcrumbContainer) {
                    breadcrumbContainer.innerHTML = '';
                    breadcrumbContainer.className = 'folder-toolbar'; // Re-use or style differently

                    const headerDiv = document.createElement('div');
                    headerDiv.className = 'folder-header';
                    // Horizontal layout for breadcrumb
                    headerDiv.style.flexDirection = 'row';
                    headerDiv.style.writingMode = 'horizontal-tb';

                    const backBtn = document.createElement('button');
                    backBtn.className = 'folder-back';
                    backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z"/></svg>';
                    backBtn.style.writingMode = 'horizontal-tb';
                    backBtn.setAttribute('aria-label', '返回全部科目');
                    backBtn.onclick = () => { document.getElementById('bankSearch').value = ''; renderFolderTiles(); };

                    const title = document.createElement('span');
                    title.className = 'folder-title';
                    title.textContent = groupName;
                    title.style.writingMode = 'horizontal-tb';

                    headerDiv.appendChild(backBtn);
                    headerDiv.appendChild(title);
                    breadcrumbContainer.appendChild(headerDiv);
                }

                (groups[groupName] || []).sort((a, b) => a.localeCompare(b, 'zh-Hant')).forEach((key, index) => {
                    // Render individual quiz items as cards
                    const card = document.createElement('div');
                    card.className = 'unit-card';
                    card.dataset.json = key;
                    if (isEditMode && selectedQuizzesForBatch.includes(key)) {
                        card.classList.add('batch-selected');
                    }

                    const iconBox = document.createElement('div');
                    iconBox.className = 'unit-icon-box';
                    iconBox.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm320-520v-200H240v640h480v-440H560ZM240-800v200-200 640-640Z"/></svg>';

                    // Edit Icon (Pen) Logic
                    const editIcon = document.createElement('button');
                    editIcon.className = 'quiz-edit-btn';
                    editIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
                    editIcon.title = '重新命名';
                    editIcon.onclick = (e) => {
                        e.stopPropagation(); // Prevent opening quiz
                        handleRenameQuiz(key);
                    };
                    card.appendChild(editIcon);

                    const infoDiv = document.createElement('div');
                    infoDiv.className = 'unit-info';

                    const title = document.createElement('div');
                    title.className = 'unit-title';
                    let displayTitle = key;
                    if (displayTitle.startsWith('_Archive_')) displayTitle = displayTitle.substring(9);
                    title.textContent = quizLabel(displayTitle).title;

                    // Archive Icon Logic
                    const archiveIcon = document.createElement('button');
                    archiveIcon.className = 'quiz-archive-btn';
                    archiveIcon.innerHTML = viewArchiveMode
                        ? `<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M480-520 680-320H560v200H400v-200H280L480-520ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0 0v-560 560Z"/></svg>`
                        : `<svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor"><path d="M480-320 280-520h120v-200h160v200h120L480-320ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0 0v-560 560Z"/></svg>`;
                    archiveIcon.title = viewArchiveMode ? '取消典藏' : '典藏題庫';
                    archiveIcon.onclick = (e) => {
                        e.stopPropagation();
                        handleArchiveQuiz(key);
                    };
                    card.appendChild(archiveIcon);

                    infoDiv.appendChild(title);

                    // Add progress indicator to card if cache has progress
                    const quizStorageName = getQuizStorageName(key);
                    const p = userProgressCache[quizStorageName];
                    let progressText = '';
                    let isCompleted = false;
                    let percent = 0;

                    if (p) {
                        const total = p.allQuestions ? p.allQuestions.length : 0;
                        const done = p.allQuestions ? p.allQuestions.filter(q => q.isAnswered).length : p.currentIndex || 0;
                        if (total > 0) {
                            percent = Math.min(100, Math.round(done / total * 100));
                            if (done >= total) {
                                isCompleted = true;
                                progressText = '已完成';
                            } else if (done > 0) {
                                progressText = `進度：${done}/${total}`;
                            }
                        }
                    }

                    const subtitle = document.createElement('div');
                    subtitle.className = 'unit-subtitle';
                    const qCount = data[key]?.count || 0;

                    const countSpan = document.createElement('span');
                    countSpan.textContent = `共 ${qCount} 題`;
                    subtitle.appendChild(countSpan);

                    if (isCompleted) {
                        const badge = document.createElement('span');
                        badge.className = 'unit-progress-text completed';
                        badge.style.display = 'inline-flex';
                        badge.style.alignItems = 'center';
                        badge.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor" style="margin-right: 2px; transform: translateY(1px);">
                                <path d="m382-320 338-338-57-57-281 281-123-122-57 57 180 180Z"/>
                            </svg>已完成
                        `;
                        subtitle.appendChild(badge);
                        card.classList.add('completed');
                    }
                    // Add progress bar inline if active progress
                    if (!isCompleted && percent > 0) {
                        const progressContainer = document.createElement('div');
                        progressContainer.className = 'unit-progress-container inline-progress';
                        progressContainer.innerHTML = `
                            <span class="unit-progress-text">${progressText}</span>
                            <div class="unit-progress-bar">
                                <div class="unit-progress-fill" style="width: ${percent}%"></div>
                            </div>
                        `;
                        subtitle.appendChild(progressContainer);
                    }
                    infoDiv.appendChild(subtitle);

                    card.appendChild(iconBox);
                    card.appendChild(infoDiv);

                    // Add staggered animation delay if desired
                    card.style.animation = `fadeInk 0.5s ease-out forwards ${index * 0.05}s`;
                    card.style.opacity = '0'; // Init hidden for keyframe

                    card.onclick = () => {
                        if (!auth.currentUser) {
                            showCustomAlert('請先登入後再開始測驗！');
                            return;
                        }
                        if (isEditMode) {
                            card.classList.toggle('batch-selected');
                            const idx = selectedQuizzesForBatch.indexOf(key);
                            if (idx > -1) {
                                selectedQuizzesForBatch.splice(idx, 1);
                            } else {
                                selectedQuizzesForBatch.push(key);
                            }
                            updateBatchActionFloatingBar();
                            return;
                        }

                        openQuizActionModal(key, userProgressCache[getQuizStorageName(key)]);
                    };

                    gridContainer.appendChild(card);

                    // Double click rename logic (preserved from previous feature request if relevant)
                    let tapTimeout;
                    card.addEventListener('click', (e) => {
                        // Logic handled above
                    });
                });
            };

            // Initial render - preserve folder view if active
            if (currentActiveFolder && groups[currentActiveFolder]) {
                renderFolderView(currentActiveFolder);
            } else {
                renderFolderTiles();
            }

        } else {
            document.getElementById('units-grid').innerHTML = '<p class="empty-state">目前沒有題庫。</p>';
        }
    } catch (error) {
        console.error('Failed to fetch quiz list:', error);
        const grid = document.getElementById('units-grid');
        grid.innerHTML = '<div class="empty-state"><p>題庫載入失敗，請確認連線後重試。</p><button class="quiet-button" id="retryCatalog">重新載入</button></div>';
        document.getElementById('retryCatalog').onclick = fetchQuizList;
    }
}


window.addEventListener('DOMContentLoaded', fetchQuizList);

// Quiz upload handling (modal-based)
const uploadModal = document.getElementById('uploadModal');
const uploadNameInput = document.getElementById('uploadNameInput');
const uploadNameLabel = document.getElementById('uploadNameLabel');
const uploadConfirmBtn = document.getElementById('uploadConfirmBtn');
let pendingFiles = [];
// Removed standalone addQuizBtn logic; use controls menu item instead
const uploadInput = document.getElementById('uploadJson');
const pasteJson = document.getElementById('pasteJson');
const fileDropZone = document.getElementById('fileDropZone');
const dropZoneLabel = document.getElementById('dropZoneLabel');
const fileSelectedList = document.getElementById('fileSelectedList');
const uploadModeRadios = uploadModal.querySelectorAll('input[name="upload-mode"]');

function updateNameLabel() {
    if (!uploadNameLabel) return;
    const mode = Array.from(uploadModeRadios).find(r => r.checked)?.value || 'paste';
    if (mode === 'paste') {
        uploadNameLabel.textContent = '題庫名稱 (可使用 科目｜單元名稱 格式)';
    } else {
        if (!pendingFiles || pendingFiles.length === 0) {
            uploadNameLabel.textContent = '題庫名稱 (可留空，預設使用檔名)';
        } else if (pendingFiles.length === 1) {
            uploadNameLabel.textContent = `題庫名稱 (留空預設：${pendingFiles[0].quizName})`;
        } else {
            uploadNameLabel.textContent = `題庫名稱 (留空直接使用個別檔名，共 ${pendingFiles.length} 份)`;
        }
    }
}

function updateFileDropZoneUI() {
    if (!dropZoneLabel) return;
    if (!pendingFiles || pendingFiles.length === 0) {
        dropZoneLabel.innerText = '點擊或拖曳 JSON 檔案至此 (支援多選)';
        if (fileSelectedList) {
            fileSelectedList.innerHTML = '';
            fileSelectedList.style.display = 'none';
        }
    } else if (pendingFiles.length === 1) {
        dropZoneLabel.innerText = `${pendingFiles[0].fileName}（${pendingFiles[0].count} 題）`;
        if (fileSelectedList) {
            fileSelectedList.innerHTML = '';
            fileSelectedList.style.display = 'none';
        }
    } else {
        const totalQ = pendingFiles.reduce((acc, f) => acc + f.count, 0);
        dropZoneLabel.innerText = `已選取 ${pendingFiles.length} 個 JSON 檔案（共 ${totalQ} 題）`;
        if (fileSelectedList) {
            fileSelectedList.innerHTML = '';
            pendingFiles.forEach(f => {
                const item = document.createElement('div');
                item.className = 'file-selected-item';
                item.innerHTML = `<span class="file-name" title="${f.quizName}">${f.quizName}</span><span class="file-count">${f.count} 題</span>`;
                fileSelectedList.appendChild(item);
            });
            fileSelectedList.style.display = 'flex';
        }
    }
    updateNameLabel();
}

async function processUploadedFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const jsonFiles = files.filter(f => f.name.toLowerCase().endsWith('.json'));
    if (jsonFiles.length === 0) {
        showCustomAlert('請提供 .json 格式的檔案');
        return;
    }

    const loaded = [];
    const errors = [];
    for (const file of jsonFiles) {
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed) throw new Error('檔案為空');
            const count = Array.isArray(parsed) ? parsed.length : (typeof parsed === 'object' ? Object.keys(parsed).length : 1);
            const quizName = file.name.replace(/\.json$/i, '');
            loaded.push({
                file,
                fileName: file.name,
                quizName,
                data: parsed,
                count
            });
        } catch (err) {
            errors.push(`${file.name} (${err.message || 'JSON 格式錯誤'})`);
        }
    }

    if (errors.length > 0) {
        showCustomAlert(`部分檔案解析錯誤：\n${errors.join('\n')}`);
        if (loaded.length === 0) return;
    }

    pendingFiles = loaded;
    uploadNameInput.value = '';
    uploadModeRadios.forEach(r => r.checked = r.value === 'file');
    document.getElementById('pasteSection').style.display = 'none';
    fileDropZone.style.display = 'block';
    uploadModal.style.display = 'flex';
    updateFileDropZoneUI();
}

function openUploadModal(defaultMode = 'paste') {
    if (!uploadModal || !pasteJson || !fileDropZone || !uploadNameInput) return;
    uploadModal.style.display = 'flex';
    uploadModeRadios.forEach(r => r.checked = r.value === defaultMode);
    if (defaultMode === 'file') {
        document.getElementById('pasteSection').style.display = 'none';
        fileDropZone.style.display = 'block';
    } else {
        document.getElementById('pasteSection').style.display = 'block';
        fileDropZone.style.display = 'none';
    }
    pasteJson.value = '';
    uploadNameInput.value = '';
    uploadInput.value = '';
    pendingFiles = [];
    updateFileDropZoneUI();
    updateNameLabel();
}

// The upload modal is opened via controls menu item (menuAddQuiz)

// Upload mode switching logic
uploadModeRadios.forEach(radio => {
    radio.addEventListener('change', e => {
        if (e.target.value === 'file') {
            document.getElementById('pasteSection').style.display = 'none';
            fileDropZone.style.display = 'block';
        } else {
            document.getElementById('pasteSection').style.display = 'block';
            fileDropZone.style.display = 'none';
        }
        updateNameLabel();
    });
});

// Click to open file selector
fileDropZone.addEventListener('click', (e) => {
    if (e.target.closest('#fileSelectedList')) return;
    uploadInput.click();
});

// Prevent default for drag events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    fileDropZone.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
    });
});

// Highlight on dragover
fileDropZone.addEventListener('dragover', () => fileDropZone.classList.add('dragover'));
fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));

// Handle drop
fileDropZone.addEventListener('drop', async e => {
    fileDropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files) {
        await processUploadedFiles(e.dataTransfer.files);
    }
});

// When files are selected via file input
uploadInput.addEventListener('change', async (e) => {
    if (e.target.files) {
        await processUploadedFiles(e.target.files);
    }
});

// Confirm upload: handle according to mode
uploadConfirmBtn.addEventListener('click', async () => {
    const mode = Array.from(uploadModeRadios).find(r => r.checked)?.value || 'paste';
    const customName = uploadNameInput.value.trim();
    const updates = {};

    if (mode === 'paste') {
        if (!customName) {
            showCustomAlert('請輸入題庫名稱');
            return;
        }
        let quizData = null;
        try {
            quizData = JSON.parse(pasteJson.value);
        } catch {
            showCustomAlert('請貼上正確的 JSON 內容');
            return;
        }
        updates[customName] = quizData;
    } else {
        if (!pendingFiles || pendingFiles.length === 0) {
            showCustomAlert('請選擇 JSON 檔案');
            return;
        }

        if (pendingFiles.length === 1) {
            const finalName = customName || pendingFiles[0].quizName;
            updates[finalName] = pendingFiles[0].data;
        } else {
            pendingFiles.forEach(pf => {
                let finalName;
                if (!customName) {
                    finalName = pf.quizName;
                } else if (customName.endsWith('｜')) {
                    finalName = customName + pf.quizName;
                } else if (pf.quizName.startsWith(customName)) {
                    finalName = pf.quizName;
                } else {
                    finalName = `${customName}｜${pf.quizName}`;
                }
                updates[finalName] = pf.data;
            });
        }
    }

    try {
        for (const [name, data] of Object.entries(updates)) {
            if (!validBankName(name)) throw new Error('題庫名稱不可包含 . # $ [ ] / 或使用系統名稱。');
            validateQuiz(data);
            if ((await get(ref(database, name))).exists()) throw new Error(`「${name}」已存在，請使用其他名稱。`);
        }
        await writeBanks(updates);
        const count = Object.keys(updates).length;
        if (count === 1) {
            showCustomAlert('題庫已新增：' + Object.keys(updates)[0]);
        } else {
            showCustomAlert(`成功新增 ${count} 份題庫！`);
        }
        fetchQuizList();
        uploadModal.style.display = 'none';
        pendingFiles = [];
        uploadInput.value = '';
        pasteJson.value = '';
        uploadNameInput.value = '';
        updateFileDropZoneUI();
    } catch (err) {
        console.error(err);
        showCustomAlert(err.message || '建立失敗，請確認題庫格式與寫入權限。');
    }
});

// On page load: default to paste mode
window.addEventListener('DOMContentLoaded', () => {
    // Check elements exist
    if (document.getElementById('pasteSection')) {
        document.getElementById('pasteSection').style.display = 'block';
        fileDropZone.style.display = 'none';
    }
});


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
const explanationDiv = document.getElementById('explanation');
const explanationText = document.getElementById('explanation-text');
const confirmBtn = document.getElementById('confirm-btn');
const starBtn = document.getElementById('starQuestion');
const showStarredBtn = document.getElementById('showStarredBtn');
const starredModal = document.getElementById('starredModal');
const starredListDiv = document.getElementById('starredList');

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

sendQuestionBtn.addEventListener('click', async () => {
    const userQuestion = userQuestionInput.value.trim();
    if (!userQuestion || sendQuestionBtn.disabled) return;
    const target = currentQuestion;
    const display = document.getElementById('explanation-text');
    if (sessionMode === 'exam' && !isTestCompleted) return;
    sendQuestionBtn.disabled = true;
    currentQuestion.usedAI = true;
    const showResponse = text => {
        if (currentQuestion !== target) return;
        display.innerHTML = markdown(target.explanation || '尚無詳解') + '<hr>' + markdown(text);
        renderLatex(display);
    };
    showResponse('正在取得回應…');
    try {
        const key = await get(ref(database, 'API_KEY'));
        if (typeof key.val() !== 'string' || !key.val().trim()) throw new Error('AI 服務尚未設定');
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key.val())}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `請以繁體中文回答以下醫學題目的提問，清楚區分已知事實與不確定之處。\n題目：${target.question}\n選項：${JSON.stringify(target.options || {})}\n題庫答案：${JSON.stringify(target.answer)}\n提問：${userQuestion}` }] }]
            })
        });
        if (!response.ok) throw new Error(`服務回應 ${response.status}`);
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n');
        if (!text) throw new Error('服務未提供回應');
        showResponse(`### AI 回覆\n${text}`);
        if (currentQuestion === target) userQuestionInput.value = '';
    } catch (error) {
        showResponse('暫時無法取得 AI 回覆，請稍後再試。');
        console.error('AI request failed', error);
    } finally { sendQuestionBtn.disabled = false; }
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


const defaultSignInLabel = 'Google 登入';
const googleLogoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false" style="margin-right:8px"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12 s5.373-12,12-12c3.059,0,5.842,1.155,7.961,3.039l5.657-5.657C33.756,6.053,29.143,4,24,4C12.955,4,4,12.955,4,24 s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,16.087,18.961,14,24,14c3.059,0,5.842,1.155,7.961,3.039l5.657-5.657 C33.756,6.053,29.143,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/><path fill="#4CAF50" d="M24,44c5.166,0,9.812-1.977,13.287-5.186l-6.142-5.195C29.104,35.091,26.715,36,24,36 c-5.202,0-9.62-3.317-11.283-7.946l-6.5,5.017C9.51,39.556,16.227,44,24,44z"/><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.117,5.629l0.003-0.002l6.142,5.195 C36.951,39.018,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/></svg>';

function updateSignInButton(user) {
    if (!signInBtn) return;

    if (user) {
        // Logged in: Hide the sign-in button completely as the top-right controls handle profile
        signInBtn.style.display = 'none';
        signInBtn.classList.remove('profile-mode');
    } else {
        // Not logged in: Show the sign-in button
        signInBtn.style.display = 'flex';
        // Minimal button with Google logo + text
        signInBtn.innerHTML = googleLogoSvg + '<span>Google 登入</span>';
        signInBtn.classList.remove('profile-mode');
        signInBtn.removeAttribute('title');
        signInBtn.setAttribute('aria-label', '使用 Google 登入');
    }
}

// Auth UI sync will be wired after controls menu elements are initialized

function isInAppBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    return (ua.indexOf("FBAN") > -1) || (ua.indexOf("FBAV") > -1) || (ua.indexOf("Line") > -1) || (ua.indexOf("Instagram") > -1);
}

async function handleGoogleSignIn() {
    if (isInAppBrowser()) {
        showCustomAlert('偵測到您正在使用 LINE、Facebook 或 Instagram 內建瀏覽器。\n\n這些環境會限制儲存空間，導致 Google 登入失敗（或顯示 "missing initial state" 錯誤）。\n\n建議點擊畫面右上角選單，選擇「在瀏覽器中開啟」或使用 Safari / Chrome 開啟此網頁進行登入。');
        return;
    }
    try {
        console.log('Starting Google Sign-In with Popup...');
        const result = await signInWithPopup(auth, googleProvider);
        console.log('Google Sign-In success, user:', result.user);
        showCustomAlert('登入成功！');
    } catch (error) {
        console.error('Google 登入失敗:', error);
        let msg = 'Google 登入失敗，請稍後再試。';
        if (error && error.code === 'auth/popup-closed-by-user') {
            msg = '已關閉登入視窗。';
        }
        showCustomAlert(msg);
    }
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
const menuStarred = document.getElementById('menuStarred');
const menuShuffle = document.getElementById('menuShuffle');
const menuTheme = document.getElementById('menuTheme');
const menuLogout = document.getElementById('menuLogout');
const menuContribute = document.getElementById('menuContribute');
const menuAddQuiz = document.getElementById('menuAddQuiz');

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
        if (!controlsMenu.contains(e.target) && e.target !== controlsMenuBtn) {
            if (controlsMenu.classList.contains('open')) {
                controlsMenu.classList.remove('open');
                controlsMenuBtn.setAttribute('aria-expanded', 'false');
                controlsMenu.setAttribute('aria-hidden', 'true');
            }
        }
        // Also close if clicking an item inside (except container clicks)
        if (controlsMenu.contains(e.target) && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
            // Optional: delay slightly or close immediately.
            // If the button logic needs to run first, standard event bubbling is fine.
            // But we should verify if we want to close for ALL buttons.
            // Logout/Theme/Shuffle/etc all seem fine to close menu.
            // Edit Name might want to keep it open? No, it toggles mode then closes.
            controlsMenu.classList.remove('open');
            controlsMenuBtn.setAttribute('aria-expanded', 'false');
            controlsMenu.setAttribute('aria-hidden', 'true');
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
        controlsMenu.classList.remove('open');
        controlsMenu.setAttribute('aria-hidden', 'true');
        if (controlsMenuBtn) controlsMenuBtn.setAttribute('aria-expanded', 'false');
    }

    if (user) {
        controlsAvatar.src = user.photoURL || 'Images/logo.png';
        menuAvatar.src = user.photoURL || 'Images/logo.png';
        menuDisplayName.textContent = user.displayName || user.email || 'Google 帳號';
        menuEmail.textContent = user.email || '';
        controlsMenuBtn.setAttribute('title', menuDisplayName.textContent);
    } else {
        // Not strictly necessary to update content if hidden, but good for state consistency
        controlsAvatar.src = 'Images/logo.png';
        menuAvatar.src = 'Images/logo.png';
        menuDisplayName.textContent = '尚未登入';
        menuEmail.textContent = '';
        controlsMenuBtn.setAttribute('title', 'Google 登入');
    }
}

// Now that controls elements exist, hook auth state listeners and initial sync
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed, user:', user ? user.displayName : 'Logged out');
    updateSignInButton(user);
    syncControlsUser(user);
    if (user) {
        await fetchUserProgressAndMistakes(user);
    } else {
        userProgressCache = {};
        userMistakesCache = {};
        learningDataReady = false;
        await loadLearning();
        closeMistakeView();
        flashcards.close();
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
if (menuStarred) menuStarred.addEventListener('click', () => {
    controlsMenu.classList.remove('open');
    openStarredModal();
});
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
const menuArchived = document.getElementById('menuArchived');
let isEditMode = false;
let viewArchiveMode = false;
let currentActiveFolder = null;
let selectedQuizzesForBatch = [];
let globalQuizGroups = {};
let globalArchivedQuizKeys = new Set();

if (menuEditQuizName) menuEditQuizName.addEventListener('click', () => {
    isEditMode = !isEditMode;
    toggleEditModeUI();
    if (typeof controlsMenu !== 'undefined' && controlsMenu) controlsMenu.classList.remove('open');
});

if (menuArchived) menuArchived.addEventListener('click', () => {
    viewArchiveMode = !viewArchiveMode;
    const label = menuArchived.querySelector('.item-label');
    if (label) label.textContent = viewArchiveMode ? '返回題庫' : '典藏庫';
    if (typeof controlsMenu !== 'undefined' && controlsMenu) controlsMenu.classList.remove('open');
    fetchQuizList();
});

// Open upload modal from controls menu
if (menuAddQuiz) menuAddQuiz.addEventListener('click', () => {
    if (controlsMenu) controlsMenu.classList.remove('open');
    openUploadModal('paste');
});

// Contribute Quiz Modal Logic
const CONTRIBUTE_AI_PROMPT = `<?xml version="1.0" encoding="UTF-8"?>
<prompt>
  <role>你是一個嚴謹的醫學與資訊學科考古題資料結構化專家。你的任務是將使用者提供的題目文本或兩份 PDF（題目卷與詳解卷），精準轉換為本系統指定的 JSON 題庫格式。你必須保持極致的客觀與結構化，絕對不加入任何額外的聊天、前言、後記或 Markdown 區塊外的註解。</role>

  <task>
    請閱讀使用者輸入的題目與詳解內容，依據下述規則進行整理與精準配對。
    **重要輸出要求**：
    1. 請依據「屆數/年份/考卷」進行分拆（舊考古則依據單元分拆），【每一屆數/年份必須獨立成一個獨立的 JSON Array】，並分別放入【各自獨立的 Markdown Code Block (\`\`\`json ... \`\`\`)】當中。
    2. 在每個 Markdown Code Block 上方，請務必標註該題庫的建議命名標題，格式必須為：\`### 科目區段｜學年度 考卷名稱\`（例如：\`### 檢驗醫學區段一｜B11 考古\`、\`### 檢驗醫學區段一｜B10 考古\`）。
       - 注意：題庫名稱中【絕對不可包含】下列字元：\`.\` \`#\` \`$\` \`[\` \`]\` \`/\`。
  </task>

  <constraints>
    ### 1. 資料處理、配對與排序
    * **資料完整性與持續性**：請務必完整處理使用者輸入的所有年份題目。若個別題目或答案完全缺失，請跳過該題；但【嚴禁因為年份或題數過多而擅自中斷、精簡或漏失任何一整年的內容】。
    * **雙文件（題目卷 + 詳解卷）交叉核對**：詳解卷與題目卷之題號可能跨頁或順序微調，請務必根據「題目核心文字」與「年份題號」雙向核對，確保題目、選項與詳解完全對齊。若詳解卷中某題無解析，\`explanation\` 請填寫空字串 \`""\`，不可遺漏題目。
    * **排序規則**：請將各年份由新到舊分開輸出（例如依序輸出 B11、B10、B09...）；在每一個年份的 JSON Array 內，題目請統一依試卷題號由第 1 題遞增排序到最後一題。
    * **內容保留**：禁止擅自修改或精簡題幹與詳解內容，但請自動「刪除句中多餘的連續空白與換行雜訊」。
    * **連續性題組**：若遇到連續性題組（共同題幹），必須在每題的 \`question\` 欄位開頭自動補上該題組的「共同背景描述」，確保單看該題也能明確理解題意。
    * **圖表與特殊符號**：若原題包含圖表或影像，請在 \`question\` 內以 \`[圖表：描述]\` 或 \`[圖片]\` 標記其相對位置。

    ### 2. 格式與排版規範
    * **純淨輸出**：整個輸出結果中【只能包含 Markdown 題庫標題與 JSON Code Blocks】。嚴禁在 Code Block 之外寫下任何「好的，以下是為您整理的...」或「注意：我修正了...」等任何人類對話或註解。
    * **中文標點**：題目與詳解若為中文，請統一使用全形標點符號（如：，、？）。
    * **上標與下標**：若出現化學式、生物標記或數學公式，請嚴格使用 LaTeX 語法包裹（例如：$CD4^+$、$T_{FH}$、$\\text{pH} < 6.5$）。
    * **特殊符號替換**：禁止使用「~」符號，請一律轉換為文字，如「2到3」或「2 to 3」，避免 Markdown 渲染錯誤。

    ### 3. 四大題型欄位規範（單選、是非 TF、多選、填空）
    * **欄位切割**：嚴禁將解釋/詳解寫到題目中，亦不得將題目內容移至解釋中。
    * **origin（出處）**：必須明確擷取並寫出是「哪一年」的「哪一題」，例如 \`"出自 B11 考古第 1 題"\` 或 \`"出自 111學年度 區段考第 5 題"\`。請將原題幹開頭的題號序號刪除。
    * **【單選題】**：
      * \`options\`：若原始選項帶有 \`(1)(2)(3)(4)\` 或 \`1.2.3.4.\`，請一律**刪除這些前綴數字**，統一對應到大寫字母鍵值（\`"A"\`, \`"B"\`, \`"C"\`, \`"D"\`，若有第五選項為 \`"E"\`）。
      * \`answer\`：必須為**單一字串**（嚴禁中括號或引號內多字母），且必須為 \`options\` 中的某一鍵。例如：\`"answer": "B"\`。
    * **【是非題】**：
      * \`options\`：欄位必須嚴格固定為 \`{"T": "True", "F": "False"}\`。若原題使用 \`(O)(X)\`，請自動在題目與詳解中更正為 \`(T)(F)\`。
      * \`answer\`：必須為單一字串 \`"answer": "T"\` 或 \`"answer": "F"\`。
    * **【多選題】**（題目註記多選，或官方答案包含兩個以上選項）：
      * \`options\`：物件，包含 2 個以上選項（\`"A"\`, \`"B"\`, \`"C"\`...）。
      * \`answer\`：必須使用 **JSON Array 格式**，包含所有正確選項代號，例如 \`"answer": ["A", "C"]\` 或 \`"answer": ["A", "B", "D"]\`。一個引號內嚴禁出現多個字母（禁止 \`"A/D"\` 或 \`"A, B"\`）。
    * **【填空題 / 簡答題】**（無選項之問答、名詞解釋或填空）：
      * \`options\`：**絕對不要建立 options 欄位（請在 JSON 中直接省略 options）**。
      * \`answer\`：必須使用 **JSON Array 格式**，列出所有可被接受的正確答案、同義詞、全稱與縮寫（作答比對時命中其中任一項即算正確）。例如：\`"answer": ["BCR-ABL", "BCR-ABL1", "BCR/ABL"]\` 或 \`"answer": ["現金股利", "股價"]\`。

    ### 4. 詳解與 AI 校正機制（嚴禁在 JSON 外部寫註解）
    * 每題均須配對對應的 \`explanation\`。
    * **題矣註記機制**：當你發現原題的詳解有誤、答案有爭議、或是你有更精準的醫學解釋時，**請直接寫在該題的 \`explanation\` 欄位內部最後面**。
    * 若修改了錯誤答案，\`answer\` 欄位請放上你認為的正確答案，並在 \`explanation\` 內容的最末端，自動換行並加上以下標記：
      \`\\n\\n**題矣註記：[在此輸入你認為更詳細的補充、正確答案或修正後的詳解]**\`
  </constraints>

  <output_schema>
    請嚴格參照以下格式輸出。每一年的 Code Block 必須是獨立、合法的 JSON Array，並在上方以 Markdown 三級標題標記題庫名稱：

### 檢驗醫學區段一｜B11 考古
\`\`\`json
[
  {
    "origin": "出自 B11 考古第 1 題",
    "question": "Which molecule is known as the energy currency of the cell?",
    "options": {
      "A": "DNA",
      "B": "ATP",
      "C": "RNA",
      "D": "NADH",
      "E": "FADH2"
    },
    "answer": "B",
    "explanation": "ATP (adenosine triphosphate) is the primary energy carrier in all living organisms."
  },
  {
    "origin": "出自 B11 考古第 2 題",
    "question": "下列關於原發性肺結核病理變化的敘述是否正確？Ghon complex 包含肺部實質病灶與肺門淋巴結腫大。",
    "options": {
      "T": "True",
      "F": "False"
    },
    "answer": "T",
    "explanation": "原發性肺結核典型的 Ghon complex 即由 Ghon focus 加上同側肺門淋巴結病變所組成。"
  },
  {
    "origin": "出自 B11 考古第 3 題",
    "question": "下列哪些數值屬於質數（Prime numbers）？（多選）",
    "options": {
      "A": "2",
      "B": "3",
      "C": "4",
      "D": "5",
      "E": "6"
    },
    "answer": ["A", "B", "D"],
    "explanation": "2, 3, and 5 are prime numbers, while 4 and 6 are composite numbers."
  },
  {
    "origin": "出自 B11 考古第 4 題",
    "question": "在慢性骨髓性白血病（CML）中，常見由 t(9;22) 染色體易位形成的費城染色體融合基因是 ______。",
    "answer": ["BCR-ABL", "BCR-ABL1", "BCR/ABL"],
    "explanation": "費城染色體造成 9 號染色體 ABL 與 22 號染色體 BCR 融合形成 BCR-ABL 融合基因。\\n\\n**題矣註記：臨床上首選標靶藥物為酪胺酸激酶抑制劑（如 Imatinib）。**"
  }
]
\`\`\`

### 檢驗醫學區段一｜B10 考古
\`\`\`json
[
  {
    "origin": "出自 B10 考古第 1 題",
    "question": "下列關於抽胸水檢查的敘述何者正確？",
    "options": {
      "A": "Eosinophilia 代表乳糜胸",
      "B": "pH < 6.5，代表食道破裂",
      "C": "Amylase 升高常見於結核性胸水",
      "D": "Glucose > 60 mg/dL 代表膿胸"
    },
    "answer": "B",
    "explanation": "食道破裂（Boerhaave syndrome）胃酸流入肋膜腔，常導致胸水 pH 顯著降低（< 6.5）。"
  }
]
\`\`\`
  </output_schema>
</prompt>`;

const contributeModal = document.getElementById('contributeModal');
const copyPromptBtn = document.getElementById('copyPromptBtn');
const promptCodeBlock = document.getElementById('promptCodeBlock');
const contributeGoUploadBtn = document.getElementById('contributeGoUploadBtn');

if (promptCodeBlock) {
    promptCodeBlock.textContent = CONTRIBUTE_AI_PROMPT;
}

if (menuContribute) {
    menuContribute.addEventListener('click', () => {
        if (controlsMenu) controlsMenu.classList.remove('open');
        if (contributeModal) contributeModal.style.display = 'flex';
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
        try {
            await navigator.clipboard.writeText(CONTRIBUTE_AI_PROMPT);
        } catch (e) {
            const textarea = document.createElement('textarea');
            textarea.value = CONTRIBUTE_AI_PROMPT;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
        copyPromptBtn.classList.add('copied');
        const label = copyPromptBtn.querySelector('.copy-label');
        const originalText = label ? label.textContent : '';
        if (label) label.textContent = '已複製 ✓';
        setTimeout(() => {
            copyPromptBtn.classList.remove('copied');
            if (label) label.textContent = originalText;
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

function toggleEditModeUI() {
    const grid = document.getElementById('units-grid');
    if (grid && menuEditQuizName) {
        const label = menuEditQuizName.querySelector('.item-label');
        if (isEditMode) {
            grid.classList.add('edit-mode');
            if (label) label.textContent = '停止編輯題庫';
        } else {
            grid.classList.remove('edit-mode');
            if (label) label.textContent = '編輯題庫';
            selectedQuizzesForBatch = [];
            const cards = document.querySelectorAll('.unit-card');
            cards.forEach(card => card.classList.remove('batch-selected'));
            updateBatchActionFloatingBar();
        }
    }
}

function updateBatchActionFloatingBar() {
    let bar = document.getElementById('batch-action-bar');
    if (selectedQuizzesForBatch.length === 0) {
        if (bar) {
            bar.classList.remove('show');
            setTimeout(() => {
                if (selectedQuizzesForBatch.length === 0 && bar && bar.parentNode) {
                    bar.parentNode.removeChild(bar);
                }
            }, 300);
        }
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'batch-action-bar';
        bar.className = 'batch-action-bar';
        document.body.appendChild(bar);
        bar.offsetHeight;
        bar.classList.add('show');
    }

    const actionText = viewArchiveMode ? '取消典藏' : '移至典藏';
    const count = selectedQuizzesForBatch.length;

    bar.innerHTML = `
        <div class="batch-bar-content">
            <span class="batch-count">已選擇 ${count} 份習題</span>
            <div class="batch-actions">
                <button class="batch-btn select-all-btn">全選</button>
                <button class="batch-btn execute-btn">${actionText}</button>
                <button class="batch-btn cancel-btn">取消</button>
            </div>
        </div>
    `;

    bar.querySelector('.select-all-btn').onclick = () => {
        if (currentActiveFolder && globalQuizGroups[currentActiveFolder]) {
            const currentQuizzes = globalQuizGroups[currentActiveFolder];
            const allSelected = currentQuizzes.every(k => selectedQuizzesForBatch.includes(k));
            if (allSelected) {
                selectedQuizzesForBatch = selectedQuizzesForBatch.filter(k => !currentQuizzes.includes(k));
            } else {
                currentQuizzes.forEach(k => {
                    if (!selectedQuizzesForBatch.includes(k)) {
                        selectedQuizzesForBatch.push(k);
                    }
                });
            }
            const cards = document.querySelectorAll('.unit-card');
            cards.forEach(card => {
                const key = card.dataset.json;
                if (key) {
                    if (selectedQuizzesForBatch.includes(key)) {
                        card.classList.add('batch-selected');
                    } else {
                        card.classList.remove('batch-selected');
                    }
                }
            });
            updateBatchActionFloatingBar();
        }
    };

    bar.querySelector('.execute-btn').onclick = async () => {
        const actionName = viewArchiveMode ? '取消典藏' : '典藏';
        if (confirm(`確定要將這 ${count} 份習題${actionName}嗎？`)) {
            try {
                const updates = {};
                for (const oldName of selectedQuizzesForBatch) {
                    const isUnarchiving = oldName.startsWith('_Archive_');
                    const newName = isUnarchiving ? oldName.substring(9) : `_Archive_${oldName}`;

                    if ((await get(ref(database, newName))).exists()) throw new Error(`「${newName}」已存在，無法覆蓋。`);
                    const snapshot = await get(ref(database, oldName));
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        updates[oldName] = null;
                        updates[newName] = data;
                    }
                }
                await writeBanks(updates);
                showCustomAlert(`已完成 ${count} 份習題的${actionName}！`);
                selectedQuizzesForBatch = [];
                updateBatchActionFloatingBar();
                fetchQuizList();
            } catch (e) {
                console.error('Batch archive failed:', e);
                showCustomAlert('批量操作失敗');
            }
        }
    };

    bar.querySelector('.cancel-btn').onclick = () => {
        selectedQuizzesForBatch = [];
        const cards = document.querySelectorAll('.unit-card');
        cards.forEach(card => card.classList.remove('batch-selected'));
        updateBatchActionFloatingBar();
    };
}

async function handleRenameQuiz(oldName) {
    let cleanOldName = oldName;
    if (cleanOldName.startsWith('_Archive_')) cleanOldName = cleanOldName.substring(9);

    let newName = prompt(`請輸入「${cleanOldName}」的新名稱:`, cleanOldName);
    if (newName && newName.trim() !== '' && newName !== cleanOldName) {
        newName = newName.trim();
        if (oldName.startsWith('_Archive_')) newName = `_Archive_${newName}`;

        try {
            if (!validBankName(newName)) throw new Error('題庫名稱格式不正確');
            if ((await get(ref(database, newName))).exists()) { showCustomAlert('此名稱已存在，請使用其他名稱。'); return; }
            // Get old data
            const snapshot = await get(ref(database, oldName));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const updates = {};
                updates[oldName] = null; // Delete old
                updates[newName] = data; // Set new

                await writeBanks(updates);
                if (selectedJson === oldName) {
                    selectedJson = newName;
                }
                showCustomAlert('已重新命名！');
                fetchQuizList(); // Refresh list
            } else {
                showCustomAlert('找不到原題庫資料');
            }
        } catch (e) {
            console.error('Rename failed:', e);
            showCustomAlert('重新命名失敗，權限不足？');
        }
    }
}

let archiveCallback = null;
const archiveConfirmModal = document.getElementById('archiveConfirmModal');
const archiveConfirmTitle = document.getElementById('archiveConfirmTitle');
const archiveConfirmMessage = document.getElementById('archiveConfirmMessage');
const archiveCancelBtn = document.getElementById('archiveCancelBtn');
const archiveActionBtn = document.getElementById('archiveActionBtn');

if (archiveCancelBtn) archiveCancelBtn.addEventListener('click', () => {
    archiveConfirmModal.style.display = 'none';
    archiveCallback = null;
});

if (archiveActionBtn) archiveActionBtn.addEventListener('click', async () => {
    if (archiveCallback) {
        archiveConfirmModal.style.display = 'none';
        await archiveCallback();
    }
});

async function handleArchiveQuiz(oldName) {
    const isUnarchiving = oldName.startsWith('_Archive_');
    const newName = isUnarchiving ? oldName.substring(9) : `_Archive_${oldName}`;
    const actionName = isUnarchiving ? '取消典藏' : '典藏';
    const displayOldName = isUnarchiving ? oldName.substring(9) : oldName;

    if (archiveConfirmTitle) archiveConfirmTitle.textContent = isUnarchiving ? '取消典藏' : '典藏題庫';
    if (archiveConfirmMessage) archiveConfirmMessage.textContent = `確定要${actionName}「${displayOldName}」嗎？`;
    if (archiveConfirmModal) archiveConfirmModal.style.display = 'flex';

    archiveCallback = async () => {
        try {
            if ((await get(ref(database, newName))).exists()) { showCustomAlert('目的題庫已存在，無法覆蓋。'); return; }
            const snapshot = await get(ref(database, oldName));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const updates = {};
                updates[oldName] = null;
                updates[newName] = data;
                await writeBanks(updates);
                showCustomAlert(`已${actionName}！`);
                if (selectedJson === oldName) {
                    selectedJson = newName;
                }
                fetchQuizList();
            }
        } catch (e) {
            console.error('Archive failed:', e);
            showCustomAlert(`${actionName}失敗`);
        }
    };
}


// Initialize shuffle state label in menu on load
updateShuffleUI();

function setStarState(isFilled) {
    if (!starBtn) return;
    if (isFilled) {
        starBtn.classList.add('active');
    } else {
        starBtn.classList.remove('active');
    }
}

function sameStar(a, b) { return a.question === b.question && (a.source || '') === (b.source || ''); }
async function updateStarIcon() {
    if (!starBtn) return;
    const question = currentQuestion;
    const source = getQuizStorageName(question.sourcePath || selectedJson);
    setStarState(false);
    if (!auth.currentUser) return;
    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        if (currentQuestion === question) setStarState((snap.val() || []).some(q => sameStar(q, { ...question, source })));
    } catch (error) { console.error('讀取收藏失敗', error); }
}
async function toggleStarCurrentQuestion() {
    if (!auth.currentUser) { showCustomAlert('登入後即可收藏題目。'); return; }
    const question = currentQuestion;
    const entry = { ...canonicalQuestion(question), source: getQuizStorageName(question.sourcePath || selectedJson) };
    starBtn.disabled = true;
    try {
        const result = await runTransaction(ref(database, `progress/${auth.currentUser.uid}/starred`), value => {
            const list = Array.isArray(value) ? value : [];
            return list.some(q => sameStar(q, entry)) ? list.filter(q => !sameStar(q, entry)) : [...list, entry];
        }, { applyLocally: false });
        if (currentQuestion === question) setStarState((result.snapshot.val() || []).some(q => sameStar(q, entry)));
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

        Object.entries(currentQuestion.options).forEach(([key, value]) => {
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

        Object.entries(currentQuestion.options).forEach(([key, value]) => {
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

async function openStarredModal() {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能查看收藏！');
        return;
    }
    starredListDiv.innerHTML = '<p style="text-align:center; padding: 20px;">載入中...</p>';
    starredModal.style.display = 'flex';

    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        let starred = snap.val() || [];

        if (starred.length === 0) {
            starredListDiv.innerHTML = '<p style="text-align:center; padding: 20px;">尚未收藏任何題目</p>';
        } else {
            starred.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
            starredListDiv.innerHTML = ''; // Clear loading

            // Process each starred item to find its mistake count
            // This might be parallelized but sequential is safer for now or Promise.all
            const mistakes = flattenMistakes(userMistakesCache);
            const processedStarred = starred.map(q => ({ ...q, mistakeCount: mistakes.find(m => m.quizKey === q.source && m.question === q.question)?.count || 0 }));

            processedStarred.forEach((q, loopIdx) => {
                const item = document.createElement('div');
                item.className = 'mistake-item'; // Reuse mistake-item style for consistency

                // --- Header: Question + Badge + Star ---
                const headerRow = document.createElement('div');
                headerRow.className = 'mistake-item-header';

                const info = document.createElement('div');
                info.className = 'mistake-info';

                // Add Source Label
                const sourceLabel = document.createElement('div');
                sourceLabel.style.fontSize = '0.8rem';
                sourceLabel.style.color = '#1a73e8';
                sourceLabel.style.marginBottom = '4px';
                sourceLabel.innerText = q.source || '未知題庫';
                info.appendChild(sourceLabel);

                const questionText = document.createElement('div');
                questionText.innerHTML = markdown(q.question);
                info.appendChild(questionText);

                // Right Side: Badge + Star Button container
                const rightSide = document.createElement('div');
                rightSide.style.display = 'flex';
                rightSide.style.alignItems = 'center';
                rightSide.style.gap = '8px';
                rightSide.style.flexShrink = '0';

                // Mistake Badge
                if (q.mistakeCount > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'mistake-count-badge';
                    if (q.mistakeCount >= 3) badge.classList.add('high-mistake');
                    badge.textContent = `${q.mistakeCount} 次錯誤`;
                    rightSide.appendChild(badge);
                }

                // Star Button (Toggle)
                const starBtnLocal = document.createElement('button');
                starBtnLocal.className = 'material-icon-btn starred'; // Reuse existing class
                starBtnLocal.style.width = '40px';
                starBtnLocal.style.height = '40px';
                starBtnLocal.setAttribute('aria-label', '取消收藏');
                starBtnLocal.setAttribute('title', '取消收藏');
                starBtnLocal.innerHTML = `
                    <span class="star-filled">★</span>
                    <span class="star-empty">☆</span>
                `;

                starBtnLocal.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // Remove from list
                    // Use the original list to filter out
                    // Note: 'starred' variable inside is from closure, but we can re-read or just filter current visual list
                    // Better to re-read to be safe or filter in memory
                    try {
                        await runTransaction(ref(database, `progress/${auth.currentUser.uid}/starred`), value => (value || []).filter(entry => !sameStar(entry, q)), { applyLocally: false });
                        starred = starred.filter(entry => !sameStar(entry, q));
                        if (!starred.length) starredListDiv.innerHTML = '<p class="empty-state">尚未收藏任何題目</p>';
                        // Remove this item from DOM visually with animation
                        item.style.opacity = '0';
                        setTimeout(() => item.remove(), 300);

                        // Update local starred array for subsequent clicks if needed, 
                        // but easier to just let UI handle it. 
                        // Also update global star button if looking at this question
                        if (currentQuestion && currentQuestion.question === q.question) {
                            setStarState(false);
                        }
                    } catch (err) {
                        console.error('Failed to unstar', err);
                        showCustomAlert('取消收藏失敗');
                    }
                });

                rightSide.appendChild(starBtnLocal);

                headerRow.appendChild(info);
                headerRow.appendChild(rightSide);
                item.appendChild(headerRow);

                // --- Details: Options ---
                if (q.options && Object.keys(q.options).length > 0) {
                    const optionsDiv = document.createElement('div');
                    optionsDiv.className = 'mistake-options';
                    let optionsHtml = '<ul>';
                    Object.entries(q.options).forEach(([k, v]) => {
                        // Check if this option is the answer
                        const isAns = Array.isArray(q.answer) ? q.answer.includes(k) : q.answer === k;
                        const parsedOpt = markdown(`${k}: ${v}`).trim();
                        optionsHtml += `<li ${isAns ? 'class="correct-option"' : ''}>${parsedOpt}</li>`;
                    });
                    optionsHtml += '</ul>';
                    optionsDiv.innerHTML = optionsHtml;
                    item.appendChild(optionsDiv);
                }

                // --- Details: Explanation ---
                const ansExpDiv = document.createElement('div');
                ansExpDiv.className = 'mistake-details';

                // Answer text
                let ansText = markdown(Array.isArray(q.answer) ? q.answer.join(', ') : q.answer);

                // Explanation text
                let expText = q.explanation ? markdown(q.explanation) : '<i>暫無詳解</i>';

                ansExpDiv.innerHTML = `
                    <div style="margin-bottom:8px;"><strong>正確答案:</strong> ${ansText}</div>
                    <div class="mistake-explanation-row"><strong>詳解:</strong> ${expText}</div>
                `;
                item.appendChild(ansExpDiv);

                starredListDiv.appendChild(item);

                // Helper to render math
                renderMathInElement(item, {
                    delimiters: [
                        { left: "$", right: "$", display: false },
                        { left: "\\(", right: "\\)", display: false },
                        { left: "$$", right: "$$", display: true },
                        { left: "\\[", right: "\\]", display: true }
                    ]
                });
            });
        }
    } catch (e) {
        console.error('讀取收藏題目失敗', e);
        starredListDiv.innerHTML = '<p>無法載入收藏</p>';
    }
}

if (starBtn) starBtn.addEventListener('click', toggleStarCurrentQuestion);
if (showStarredBtn) showStarredBtn.addEventListener('click', openStarredModal);
if (starredModal) starredModal.addEventListener('click', (e) => {
    if (e.target === starredModal) starredModal.style.display = 'none';
});

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
const flashcards = createFlashcards({ renderMath: renderLatex });

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
        const snap = await get(ref(database, `mistakes/${uid}`));
        if (auth.currentUser?.uid === uid) userMistakesCache = snap.val() || {};
    },
    setStatus: async (m, status) => {
        const uid = auth.currentUser.uid;
        const result = await runTransaction(ref(database, `mistakes/${uid}/${m.quizKey}/${m.recordPath}`), value => value ? {
            ...value, status, correctStreak: status === 'active' ? 0 : value.correctStreak || 0, statusUpdated: Date.now()
        } : undefined, { applyLocally: false });
        if (result.committed && auth.currentUser?.uid === uid) cacheMistake(m.quizKey, m.recordPath, result.snapshot.val());
    },
    makeCards: items => flashcards.generate(items),
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
        return preparePractice({ ...m, sourcePath: source?.path || m.sourcePath || m.quizKey, originalIndex: index }, index >= 0 ? source.questions[index] : null);
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

    if (!modal) return;

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
        closeQuizActionModal();
        startFreshQuiz(key);
    };

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

        const [progressSnap, mistakesSnap] = await Promise.all([
            get(ref(database, `progress/${user.uid}/quizzes`)),
            get(ref(database, `mistakes/${user.uid}`))
        ]);

        if (auth.currentUser?.uid !== user.uid) return;
        userProgressCache = progressSnap.exists() ? progressSnap.val() : {};
        userMistakesCache = mistakesSnap.exists() ? mistakesSnap.val() : {};
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

// Global Mistakes bindings
const menuGlobalMistakes = document.getElementById('menuGlobalMistakes');
if (menuGlobalMistakes) menuGlobalMistakes.addEventListener('click', () => {
    controlsMenu.classList.remove('open');
    openMistakeView(null);
});

const quizActionCloseBtn = document.getElementById('quizActionCloseBtn');
if (quizActionCloseBtn) quizActionCloseBtn.addEventListener('click', () => {
    closeQuizActionModal();
});


// Home shortcuts keep frequently used collections out of the account menu.
document.getElementById('homeMistakes').onclick = () => openMistakeView();
document.getElementById('homeStarred').onclick = () => openStarredModal();
// Div-based legacy cards retain their nested edit controls and gain keyboard access.
const unitsGrid = document.getElementById('units-grid');
new MutationObserver(() => {
    unitsGrid.querySelectorAll('.unit-card').forEach(card => { card.tabIndex = 0; card.setAttribute('role', 'button'); });
}).observe(unitsGrid, { childList: true, subtree: true });
unitsGrid.addEventListener('keydown', e => {
    if (e.target.matches('.unit-card') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.target.click(); }
});
document.getElementById('bankSearch').addEventListener('input', e => {
    const query = e.target.value.trim().toLowerCase();
    unitsGrid.querySelectorAll('.unit-card').forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(query); });
});

function returnHome() {
    stopTimer();
    document.body.classList.remove('exam-active');
    quizContainer.style.display = 'none';
    endScreenDiv?.remove();
    document.querySelector('.start-screen').style.display = 'flex';
    selectedJson = null;
    document.title = '題矣';
    document.getElementById('bankSearch').value = '';
    updateRestorePreview(auth.currentUser);
    fetchQuizList();
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

mountLearningHub({ openCards: () => flashcards.open(), getCatalog: () => catalogData, alert: showCustomAlert, current: () => currentQuestion,
    start: async (items, mode, options) => {
        customSession = { questions: items, mode, ...options }; selectedJson = items[0].sourcePath;
        await initQuiz(); document.querySelector('.quiz-title').textContent = mode === 'exam' ? '自訂測驗 · 考試' : '自訂測驗 · 學習';
    }
});

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

mountEditorial();

mountSidebar();
