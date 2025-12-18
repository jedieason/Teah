// Firebase SDK imports and initialization (v11.6.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getDatabase, ref, get, update, set, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBDUkxPjus-JYd2WZqys_eP5sWxLkMs2CI",
    authDomain: "stock-market-ntumed.firebaseapp.com",
    databaseURL: "https://stock-market-ntumed-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "stock-market-ntumed",
    storageBucket: "stock-market-ntumed.firebasestorage.app",
    messagingSenderId: "1032461117274",
    appId: "1:1032461117274:web:33b51256202657864ff563",
    measurementId: "G-5ZZWMMLEKK"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);
// Firebase Auth
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Handle Redirect Result
getRedirectResult(auth)
    .then((result) => {
        if (result && result.user) {
            console.log('Redirect sign-in success:', result.user);
            // Optionally notification is handled by onAuthStateChanged or we can show one here
            // showCustomAlert('登入成功！');
        }
    })
    .catch((error) => {
        console.error('Redirect sign-in error:', error);
        // We can show custom alert if showCustomAlert is available, but it might not be defined yet if it's further down.
        // Usually safe to relying on console or simple alert, or wait for DOM. 
        // Since this runs top-level, functions might be hoisted.
    });
const signInBtn = document.getElementById('signInBtn');
// Restore preview elements
const restoreBtn = document.getElementById('restore');
const restoreTitleEl = document.getElementById('restoreTitle');
const restoreSubtitleEl = document.getElementById('restoreSubtitle');
const restoreProgressBarEl = document.getElementById('restoreProgressBar');
if (restoreBtn) restoreBtn.style.display = 'none';

async function updateRestorePreview(user) {
    const continueSection = document.getElementById('continue-section');
    const titleText = document.getElementById('continue-title-text');
    const statsText = document.getElementById('continue-stats-text');
    const progressFill = document.getElementById('continue-progress-fill');
    const continueBtn = document.getElementById('continue-btn-action');

    // Helper to hide section
    const hideSection = () => { if (continueSection) continueSection.style.display = 'none'; };

    try {
        if (!user) { hideSection(); return; }

        const snap = await get(ref(database, `progress/${user.uid}/progress`));
        if (!snap.exists()) { hideSection(); return; }

        const p = snap.val();
        const fileName = (p.selectedJson || '').split('/').pop().replace('.json', '') || '最近的中斷點';
        const total = (p.questions?.length || 0) + (p.correct || 0) + (p.wrong || 0);
        const done = (p.correct || 0) + (p.wrong || 0);
        const percent = total > 0 ? Math.round(done / total * 100) : 0;

        if (percent <= 0 && done === 0) { hideSection(); return; }

        // Populate and show section
        if (continueSection) continueSection.style.display = 'block';
        if (titleText) titleText.textContent = fileName;
        if (statsText) statsText.textContent = `進度：${done}/${total}`;
        if (progressFill) progressFill.style.width = `${percent}%`;

        // Attach click handler if not already (or overwrite)
        if (continueBtn) {
            continueBtn.onclick = () => {
                // Trigger existing restore logic
                restoreProgress();
            };
        }
    } catch (e) {
        console.error(e);
        hideSection();
    }
}

let questions = [];
let initialQuestionCount = 0;
let currentQuestion = {};
let acceptingAnswers = true;
let selectedOption = null; // 單選題使用
let selectedOptions = [];  // 多選題使用
let correct = 0;
let wrong = 0;
let selectedJson = null; // 初始為 null
// Fill-in-the-blank elements
const fillblankContainer = document.querySelector('.fillblank-container');
const fillblankInput = document.getElementById('fillblank-input');
let isTestCompleted = false; // Flag to track test completion

// Quiz container reference for restoring UI on redo
const quizContainer = document.querySelector('.quiz-container');
const originalQuizDisplay = quizContainer.style.display || 'flex';
let endScreenDiv = null;

// 新增：洗牌偏好設定
let shouldShuffleQuiz = false; // false: 固定順序 (JSON 順序), true: 隨機順序

// 新增：歷史紀錄陣列
let questionHistory = [];
let wrongQuestions = [];



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
    localStorage.removeItem('quizProgress');

    await loadQuestions();
    initialQuestionCount = questions.length;
    document.querySelector('.start-screen').style.display = 'none';
    document.querySelector('.quiz-container').style.display = 'flex';

    // Update the quiz title with the current file name
    const fileName = selectedJson.split('/').pop().replace('.json', '');
    document.querySelector('.quiz-title').innerText = `${fileName}`;
    document.title = `${fileName} - 題矣`;

    loadNewQuestion();
    updateProgressBar(); // Initialize progress bar when quiz starts
}

// 加載題目 (Firebase)
async function loadQuestions() {
    try {
        const snapshot = await get(ref(database, selectedJson));
        if (snapshot.exists()) {
            questions = snapshot.val();
        } else {
            console.error('No questions found at path:', selectedJson);
            questions = [];
        }
    } catch (error) {
        console.error('Failed to load questions from Firebase:', error);
    }
}

// 洗牌函數
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function loadNewQuestion() {
    // 如果有當前問題，將其推入歷史紀錄
    if (currentQuestion && currentQuestion.question) {
        questionHistory.push({
            questionState: JSON.parse(JSON.stringify(currentQuestion)), // Deep copy of the question state
            userSelection: currentQuestion.isFillBlank ? fillblankInput.value : (currentQuestion.isMultiSelect ? [...selectedOptions] : selectedOption),
            isConfirmed: !acceptingAnswers, // Was the answer confirmed?
            correctCount: correct, // Score *after* this question was processed
            wrongCount: wrong,   // Score *after* this question was processed
            fillBlankValueRestore: currentQuestion.isFillBlank ? fillblankInput.value : null,
            fillBlankDisabledRestore: currentQuestion.isFillBlank ? fillblankInput.disabled : null,
            fillBlankClassesRestore: currentQuestion.isFillBlank ? Array.from(fillblankInput.classList) : null
        });
    }

    document.getElementById('WeeGPTInputSection').style.display = 'none';

    // Start Timer for new question
    startTimer();

    // 重置狀態
    acceptingAnswers = true;
    // 根據題型初始化選取資料
    if (Array.isArray(currentQuestion.answer) && currentQuestion.answer.length > 1) {
        currentQuestion.isMultiSelect = true;
        selectedOptions = [];
    } else {
        currentQuestion.isMultiSelect = false;
        selectedOption = null;
    }
    document.getElementById('explanation').style.display = 'none';
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.display = 'block';
    document.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected', 'correct', 'incorrect', 'missing');
    });

    if (questions.length === 0) {
        // 沒有更多題目，結束測驗
        stopTimer();
        showEndScreen();
        return;
    }

    // 獲取題目
    if (shouldShuffleQuiz) {
        shuffle(questions); // 如果設定為隨機，則洗牌題庫
        currentQuestion = questions.pop(); // 從尾端取出一題
    } else {
        currentQuestion = questions.shift(); // 如果設定為固定順序，則從前端取出一題
    }

    // 判斷填空題（無 options 屬性）
    if (!currentQuestion.options) {
        currentQuestion.isFillBlank = true;
        document.getElementById('options').style.display = 'none';
        fillblankContainer.style.display = 'flex';
        fillblankInput.value = '';
        // 重置填空題輸入框狀態
        fillblankInput.disabled = false;
        fillblankInput.classList.remove('correct', 'incorrect');
        // 確保填空題不被標示為多選題
        currentQuestion.isMultiSelect = false;
    } else {
        currentQuestion.isFillBlank = false;
        document.getElementById('options').style.display = 'flex';
        fillblankContainer.style.display = 'none';
    }

    // 判斷是否為多選題（答案為陣列且長度超過1）
    if (Array.isArray(currentQuestion.answer) && currentQuestion.answer.length > 1) {
        currentQuestion.isMultiSelect = true;
    } else {
        currentQuestion.isMultiSelect = false;
    }

    // 更新題目文本，若為多選題則加上標籤
    const questionDiv = document.getElementById('question');
    const questionHtml = marked.parse(currentQuestion.question);
    if (currentQuestion.isMultiSelect) {
        const labelText = currentQuestion.isFillBlank ? '句' : '多';
        questionDiv.innerHTML = `
<div class="question-wrapper">
    <div class="multi-label">${labelText}</div>
    <div class="question-text">${questionHtml}</div>
</div>
        `;
    } else {
        questionDiv.innerHTML = `<div class="question-text">${questionHtml}</div>`;
    }
    renderMathInElement(questionDiv, {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });

    if (!currentQuestion.isFillBlank) {
        // 檢查題型
        const optionKeys = Object.keys(currentQuestion.options);
        let optionLabels = [];
        let shouldShuffleOptionContent = true; // 控制選項內容是否洗牌

        if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
            // 是是非題
            optionLabels = ['T', 'F'];
            shouldShuffleOptionContent = false; // 是非題的選項標籤固定，不洗牌選項內容順序
        } else {
            // 單選題（或多選題）都用這組標籤
            optionLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
            shouldShuffleOptionContent = shouldShuffleQuiz; // 選項內容是否洗牌取決於全域設定
        }

        // 獲取選項條目
        let optionEntries = Object.entries(currentQuestion.options);

        // 如果需要洗牌選項內容，則洗牌
        if (shouldShuffleOptionContent) {
            shuffle(optionEntries);
        } else if (optionLabels.length === 2 && optionLabels[0] === 'T' && optionLabels[1] === 'F') {
            // 是非題且不洗牌時，確保 T 在 F 之前
            optionEntries.sort((a, b) => {
                const order = { 'T': 0, 'F': 1 };
                return order[a[0]] - order[b[0]];
            });
        }

        // 正確構建 labelMapping
        let labelMapping = {};
        for (let i = 0; i < optionEntries.length; i++) {
            const [originalLabel, _] = optionEntries[i];
            labelMapping[originalLabel] = optionLabels[i];
        }

        // 更新選項
        const optionsContainer = document.getElementById('options');
        optionsContainer.innerHTML = '';
        let newOptions = {};
        let newAnswer = currentQuestion.isMultiSelect ? [] : '';
        for (let i = 0; i < optionEntries.length; i++) {
            const [label, text] = optionEntries[i];
            const newLabel = optionLabels[i];
            newOptions[newLabel] = text;

            const button = document.createElement('button');
            button.classList.add('option-button');
            button.dataset.option = newLabel;
            button.innerHTML = marked.parse(`${newLabel}: ${text}`);
            button.addEventListener('click', selectOption);
            optionsContainer.appendChild(button);

            // 對於單選題，若原答案與 label 相符則更新；多選題則假設 currentQuestion.answer 為原有正確答案陣列
            if (currentQuestion.isMultiSelect) {
                if (Array.isArray(currentQuestion.answer) && currentQuestion.answer.includes(label)) {
                    newAnswer.push(newLabel);
                }
            } else {
                if (label === currentQuestion.answer) {
                    newAnswer = newLabel;
                }
            }
        }

        // 更新題目的選項和答案
        currentQuestion.options = newOptions;
        currentQuestion.answer = newAnswer;

        // 更新詳解中的選項標籤
        currentQuestion.explanation = updateExplanationOptions(currentQuestion.explanation, labelMapping);

        // 更新模態窗口的內容 (If exists)
        const popupWindow = document.getElementById('popupWindow');
        if (popupWindow) {
            const qEl = popupWindow.querySelector('.editable:nth-child(2)');
            const oEl = popupWindow.querySelector('.editable:nth-child(3)');
            const aEl = popupWindow.querySelector('.editable:nth-child(5)');
            const eEl = popupWindow.querySelector('.editable:nth-child(7)');

            if (qEl) qEl.innerText = currentQuestion.question;
            if (oEl) {
                const optionsText = Object.entries(currentQuestion.options).map(([key, value]) => `${key}: ${value}`).join('\n');
                oEl.innerText = optionsText;
            }
            if (aEl) aEl.innerText = currentQuestion.answer;
            if (eEl) eEl.innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！';
        }
    }
    saveProgress();
    updateProgressBar();
    updateStarIcon();
}

function updateExplanationOptions(explanation, labelMapping) {
    if (!explanation) {
        return '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！';
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
    if (isTestCompleted) {
        location.reload();
        return;
    }
    if (typeof customAlertConfirmCallback === 'function') {
        const cb = customAlertConfirmCallback;
        customAlertConfirmCallback = null;
        try { cb(); } catch (e) { console.error(e); }
    }
});

// 修改確認按鈕函數
// 修改確認按鈕函數
function confirmAnswer() {
    // 處理填空題邏輯
    if (currentQuestion.isFillBlank) {
        const userInput = fillblankInput.value.trim();
        if (!userInput) {
            showCustomAlert('請輸入您的答案！');
            return;
        }
        stopTimer(); // Valid input, stop timer

        // 直接作為句子驗證關鍵字
        const sentence = userInput.toLowerCase();
        const required = Array.isArray(currentQuestion.answer) ? currentQuestion.answer : [currentQuestion.answer];
        // 檢查是否包含所有關鍵字
        const allMatch = required.every(keyword => sentence.includes(keyword.toLowerCase()));
        if (allMatch) {
            updateCorrect();
            fillblankInput.classList.add('correct');
        } else {
            updateWrong();
            fillblankInput.classList.add('incorrect');
        }
        // 回答後禁止再修改
        fillblankInput.disabled = true;
        // 禁止再次確認，Enter 進入下一題
        acceptingAnswers = false;
        // 顯示詳解
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        renderLatex(document.getElementById('explanation-text'));
        document.getElementById('explanation').style.display = 'block';
        document.getElementById('confirm-btn').style.display = 'none';
        const originDisplay = document.getElementById('origin-display');
        if (currentQuestion.origin) {
            originDisplay.textContent = currentQuestion.origin;
            originDisplay.style.display = 'block';
        } else {
            originDisplay.style.display = 'none';
        }
        saveProgress();
        return;
    } else {
        if (currentQuestion.isMultiSelect) {
            if (selectedOptions.length === 0) {
                showCustomAlert('選點啥吧，用猜的也好！');
                return;
            }
            stopTimer(); // Valid selection, stop timer
            acceptingAnswers = false;
            document.getElementById('confirm-btn').disabled = true;
            // 檢查所有選項
            document.querySelectorAll('.option-button').forEach(btn => {
                const option = btn.dataset.option;
                if (currentQuestion.answer.includes(option)) {
                    // 正確答案
                    if (selectedOptions.includes(option)) {
                        btn.classList.add('correct');
                    } else {
                        // 正確但未選取：標示缺漏
                        btn.classList.add('missing');
                    }
                } else {
                    if (selectedOptions.includes(option)) {
                        btn.classList.add('incorrect');
                    }
                }
            });
            // 判斷是否全對
            let isCompletelyCorrect = (selectedOptions.length === currentQuestion.answer.length) &&
                currentQuestion.answer.every(opt => selectedOptions.includes(opt));
            if (isCompletelyCorrect) {
                updateCorrect();
            } else {
                updateWrong();
            }
        } else {
            if (!selectedOption) {
                showCustomAlert('選點啥吧，用猜的也好！');
                return;
            }
            stopTimer(); // Valid selection, stop timer
            acceptingAnswers = false;
            document.getElementById('confirm-btn').disabled = true;
            const selectedBtn = document.querySelector(`.option-button[data-option='${selectedOption}']`);
            if (selectedOption === currentQuestion.answer) {
                if (selectedBtn) selectedBtn.classList.add('correct');
                updateCorrect();
            } else {
                if (selectedBtn) selectedBtn.classList.add('incorrect');
                const correctBtn = document.querySelector(`.option-button[data-option='${currentQuestion.answer}']`);
                if (correctBtn) {
                    correctBtn.classList.add('correct');
                } else {
                    // 找不到正確選項的按鈕，提示並提供跳至下一題
                    showCustomAlert('遇到問題，是否先前往下一題？', () => {
                        loadNewQuestion();
                    });
                }
                updateWrong();
            }
        }
        // 顯示詳解
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        renderLatex(document.getElementById('explanation-text'));
        document.getElementById('explanation').style.display = 'block';
        document.getElementById('confirm-btn').style.display = 'none';
        const originDisplay = document.getElementById('origin-display');
        if (currentQuestion.origin) {
            originDisplay.textContent = currentQuestion.origin;
            originDisplay.style.display = 'block';
        } else {
            originDisplay.style.display = 'none';
        }
        saveProgress();
    }
}

function updateCorrect() {
    correct += 1;
    document.getElementById('correct').innerText = correct;
    updateProgressBar(true);
}

function updateWrong() {
    wrongQuestions.push(currentQuestion);
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
    updateProgressBar(false);
    recordMistake();
}

function showEndScreen() {
    isTestCompleted = true;
    // Hide quiz UI and show a separate end screen overlay
    quizContainer.style.display = 'none';

    endScreenDiv = document.createElement('div');
    endScreenDiv.className = 'end-screen-container';
    endScreenDiv.style.display = 'flex';
    endScreenDiv.style.flexDirection = 'column';
    endScreenDiv.style.justifyContent = 'center';
    endScreenDiv.style.alignItems = 'center';

    // Show completion message
    const message = document.createElement('div');
    message.innerText = `測驗完成！答對 ${correct} 題；答錯 ${wrong} 題。`;
    message.style.margin = '20px';
    endScreenDiv.appendChild(message);

    // "Redo Wrong" and "Reselect Quiz" buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'end-buttons';

    const redoBtn = document.createElement('button');
    redoBtn.innerText = '重做錯題';
    redoBtn.classList.add('select-button');
    redoBtn.addEventListener('click', () => {
        if (wrongQuestions.length === 0) {
            alert('沒有錯題可重做！');
            return;
        }
        // Reset state for wrong questions
        questions = wrongQuestions.slice();
        wrongQuestions = [];
        correct = 0;
        wrong = 0;
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;
        if (endScreenDiv) endScreenDiv.remove();
        quizContainer.style.display = originalQuizDisplay;
        loadNewQuestion();
    });
    buttonsDiv.appendChild(redoBtn);

    const resetBtn = document.createElement('button');
    resetBtn.innerText = '重新選題庫';
    resetBtn.classList.add('select-button');
    resetBtn.addEventListener('click', () => {
        location.reload();
    });
    buttonsDiv.appendChild(resetBtn);

    endScreenDiv.appendChild(buttonsDiv);
    quizContainer.parentNode.appendChild(endScreenDiv);
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
document.getElementById('restore').addEventListener('click', () => {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能恢復進度！');
        return;
    }
    restoreProgress();
});
document.getElementById('reverseButton').addEventListener('click', reverseQuestion);

function reverseQuestion() {
    if (questionHistory.length === 0) {
        showCustomAlert('沒有上一題了！');
        return;
    }
    stopTimer(); // Stop timer when going back

    // Push the current question back to the main questions array, maintaining order in non-shuffle mode
    if (currentQuestion && currentQuestion.question) {
        if (shouldShuffleQuiz) {
            questions.push(currentQuestion);
        } else {
            questions.unshift(currentQuestion);
        }
        // Maintain order for forward navigation
    }

    const previousState = questionHistory.pop();

    // Restore the question object and scores
    currentQuestion = previousState.questionState;
    correct = previousState.correctCount;
    wrong = previousState.wrongCount;

    // Update score display
    document.getElementById('correct').innerText = correct;
    document.getElementById('wrong').innerText = wrong;
    updateProgressBar();

    // Display question text, replicating logic from loadNewQuestion for labels
    const questionDiv = document.getElementById('question');
    if (currentQuestion.isMultiSelect) {
        const labelText = currentQuestion.isFillBlank ? '句' : '多';
        questionDiv.innerHTML = `<div class="multi-label">${labelText}</div>` + marked.parse(currentQuestion.question);
    } else {
        questionDiv.innerHTML = marked.parse(currentQuestion.question);
    }
    renderMathInElement(questionDiv, {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });

    // Handle fill-in-the-blank or options
    if (currentQuestion.isFillBlank) {
        document.getElementById('options').style.display = 'none';
        fillblankContainer.style.display = 'flex';
        fillblankInput.value = previousState.fillBlankValueRestore || '';

        if (previousState.fillBlankClassesRestore) {
            fillblankInput.className = 'fillblank-input'; // Reset to base class
            previousState.fillBlankClassesRestore.forEach(cls => {
                if (cls !== 'fillblank-input') fillblankInput.classList.add(cls);
            });
        } else {
            fillblankInput.className = 'fillblank-input'; // Ensure it's reset if no classes were stored
        }
        fillblankInput.disabled = previousState.fillBlankDisabledRestore === true;

        acceptingAnswers = !previousState.isConfirmed;

    } else { // Multiple choice or True/False
        document.getElementById('options').style.display = 'flex';
        fillblankContainer.style.display = 'none';

        const optionsContainer = document.getElementById('options');
        optionsContainer.innerHTML = ''; // Clear previous options

        let optionEntriesToDisplay = Object.entries(currentQuestion.options || {});
        const isTrueFalse = optionEntriesToDisplay.length === 2 &&
            optionEntriesToDisplay.every(entry => ['T', 'F'].includes(entry[0]));

        if (shouldShuffleQuiz && !isTrueFalse) {
            shuffle(optionEntriesToDisplay); // Shuffle display order of A,B,C... buttons
        } else {
            // Ensure fixed order (A,B,C... or T,F)
            optionEntriesToDisplay.sort((a, b) => {
                if (isTrueFalse) { // Specific T,F order
                    if (a[0] === 'T' && b[0] === 'F') return -1; // T before F
                    if (a[0] === 'F' && b[0] === 'T') return 1;  // F after T
                    return 0;
                }
                return a[0].localeCompare(b[0]); // Alphabetical for A,B,C...
            });
        }

        const userSelection = previousState.userSelection;

        optionEntriesToDisplay.forEach(([key, value]) => {
            const button = document.createElement('button');
            button.classList.add('option-button');
            button.dataset.option = key;
            button.innerHTML = marked.parse(`${key}: ${value}`);
            renderLatex(button); // Render LaTeX in the option button

            if (previousState.isConfirmed) {
                // Apply selection and correctness styling
                if (currentQuestion.isMultiSelect) {
                    if (Array.isArray(userSelection) && userSelection.includes(key)) {
                        button.classList.add('selected');
                    }
                    if (Array.isArray(currentQuestion.answer) && currentQuestion.answer.includes(key)) {
                        if (Array.isArray(userSelection) && userSelection.includes(key)) {
                            button.classList.add('correct');
                        } else {
                            button.classList.add('missing');
                        }
                    }
                } else { // Single select
                    if (userSelection === key) {
                        button.classList.add('selected');
                    }
                    if (key === currentQuestion.answer) {
                        button.classList.add('correct');
                    } else if (userSelection === key) {
                        button.classList.add('incorrect');
                    }
                }
            } else { // Not confirmed, set up for interaction
                button.addEventListener('click', selectOption);
                if (currentQuestion.isMultiSelect) {
                    if (Array.isArray(userSelection) && userSelection.includes(key)) {
                        button.classList.add('selected');
                    }
                } else {
                    if (userSelection === key) {
                        button.classList.add('selected');
                    }
                }
            }
            optionsContainer.appendChild(button);
        });
        acceptingAnswers = !previousState.isConfirmed;

        // Restore global selectedOption/selectedOptions
        if (currentQuestion.isMultiSelect) {
            selectedOptions = Array.isArray(userSelection) ? [...userSelection] : [];
            selectedOption = null;
        } else {
            selectedOption = userSelection;
            selectedOptions = [];
        }
    }

    // Explanation and confirm button visibility
    const explanationElement = document.getElementById('explanation');
    const confirmBtnElement = document.getElementById('confirm-btn');

    if (previousState.isConfirmed) {
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！');
        renderLatex(document.getElementById('explanation-text'));
        explanationElement.style.display = 'block';
        confirmBtnElement.style.display = 'none';
        confirmBtnElement.disabled = true;
        const originDisplay = document.getElementById('origin-display');
        if (currentQuestion.origin) {
            originDisplay.textContent = currentQuestion.origin;
            originDisplay.style.display = 'block';
        } else {
            originDisplay.style.display = 'none';
        }
    } else {
        explanationElement.style.display = 'none';
        document.getElementById('origin-display').style.display = 'none';
        confirmBtnElement.style.display = 'block';
        confirmBtnElement.disabled = false;
    }

    document.getElementById('WeeGPTInputSection').style.display = 'none';

    saveProgress(); // Save the restored state
}

document.addEventListener('keydown', function (event) {
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
    // Ignore shortcuts while typing in topic search
    if (event.target && event.target.id === 'topicSearch') {
        return;
    }
    if (event.key.toLowerCase() === 'q') {
        event.preventDefault();
        weeGPTButton.click();
        return;
    }
    const validOptions = currentQuestion && currentQuestion.options ? Object.keys(currentQuestion.options) : [];
    if (acceptingAnswers && validOptions.includes(event.key.toUpperCase())) {
        const optionButton = document.querySelector(`.option-button[data-option='${event.key.toUpperCase()}']`);
        if (optionButton) {
            optionButton.click();
        }
    } else if (event.key === 'Enter') {
        const activeEl = document.activeElement;
        // If an input/textarea is focused and the Enter event is part of IME composition,
        // let the IME handle Enter to finalize composition.
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && event.isComposing) {
            return;
        }

        if (acceptingAnswers) {
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
    const st = document.getElementById('shuffleToggle');
    if (st) st.title = shouldShuffleQuiz ? '順序：隨機' : '順序：固定';
    const menuShuffleEl = document.getElementById('menuShuffle');
    if (menuShuffleEl) menuShuffleEl.textContent = '隨機順序（' + (shouldShuffleQuiz ? '亂序' : '照順序') + '）';
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
    event.preventDefault();
    event.returnValue = '';
});

// Rename Quiz Function
function startRenamingQuiz(oldName, btnElement) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'rename-input';

    // Replace button content
    btnElement.innerHTML = '';
    btnElement.appendChild(input);
    input.focus();

    let isCommitting = false;
    const commit = async () => {
        if (isCommitting) return;
        isCommitting = true;
        const newName = input.value.trim();
        if (!newName || newName === oldName) {
            btnElement.textContent = oldName;
            isCommitting = false;
            return;
        }

        try {
            // Check existence
            const newRef = ref(database, newName);
            const snap = await get(newRef);
            if (snap.exists()) {
                alert('該名稱已存在！');
                btnElement.textContent = oldName;
                isCommitting = false;
                return;
            }

            // Move data
            const oldRef = ref(database, oldName);
            const oldSnap = await get(oldRef);
            if (oldSnap.exists()) {
                const data = oldSnap.val();
                await set(newRef, data);
                await remove(oldRef);
                if (selectedJson === oldName) {
                    selectedJson = newName;
                }
                fetchQuizList();
            }
        } catch (e) {
            console.error(e);
            alert('更名失敗: ' + e.message);
            btnElement.textContent = oldName;
        }
        isCommitting = false;
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
}

/*
 * Timer Logic
 */
/*
 * Timer Logic
 */
/*
 * Timer Logic (Smooth Pie Chart)
 */
function startTimer() {
    if (timerFrameId) cancelAnimationFrame(timerFrameId);

    const duration = 15000; // 15 seconds
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
        const listRef = ref(database, '/');  // 根目錄或指定清單路徑
        const snapshot = await get(listRef);
        // Target new grid container
        const gridContainer = document.getElementById('units-grid');
        const breadcrumbContainer = document.getElementById('folder-breadcrumb');

        if (gridContainer) gridContainer.innerHTML = '';

        if (snapshot.exists()) {
            const data = snapshot.val();
            const allKeys = Object.keys(data || {});
            const quizKeys = allKeys.filter(k => k !== 'progress' && k !== 'API_KEY' && k !== 'mistakes' && k !== 'mistake');
            const groups = {};
            quizKeys.forEach(k => {
                const idx = k.indexOf('學');
                const groupName = idx !== -1 ? k.slice(0, idx + 1) : '其他';
                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(k);
            });

            const sortGroups = (names) => names.sort((a, b) => {
                if (a === '其他' && b !== '其他') return 1;
                if (b === '其他' && a !== '其他') return -1;
                return a.localeCompare(b, 'zh-Hant');
            });

            const renderFolderTiles = () => {
                if (gridContainer) {
                    gridContainer.innerHTML = '';
                    gridContainer.className = 'units-grid'; // Reset class
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

                    card.onclick = () => renderFolderView(groupName);

                    gridContainer.appendChild(card);
                });

                if (breadcrumbContainer) breadcrumbContainer.innerHTML = ''; // Clear header in tile view
            };

            const renderFolderView = (groupName) => {
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
                    backBtn.onclick = () => renderFolderTiles();

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
                    title.textContent = key;

                    infoDiv.appendChild(title);

                    card.appendChild(iconBox);
                    card.appendChild(infoDiv);

                    // Add staggered animation delay if desired
                    card.style.animation = `fadeInk 0.5s ease-out forwards ${index * 0.05}s`;
                    card.style.opacity = '0'; // Init hidden for keyframe

                    card.onclick = () => {
                        selectedJson = key;
                        document.querySelector('.start-screen').style.display = 'none';
                        // initQuiz logic
                        initQuiz().then(() => {
                            saveProgress();
                        });
                    };

                    gridContainer.appendChild(card);

                    // Double click rename logic (preserved from previous feature request if relevant)
                    let tapTimeout;
                    card.addEventListener('click', (e) => {
                        // Logic handled above
                    });
                });
            };

            // Search Logic Update (simple version for now)
            const searchInput = document.getElementById('topicSearch');
            if (searchInput) {
                searchInput.oninput = (e) => {
                    const val = e.target.value.toLowerCase();
                    if (!val) { renderFolderTiles(); return; }
                    if (breadcrumbContainer) breadcrumbContainer.innerHTML = '';

                    const gridContainer = document.getElementById('units-grid');
                    gridContainer.innerHTML = '';

                    const allItems = Object.values(groups).flat();
                    const matches = allItems.filter(k => k.toLowerCase().includes(val));

                    matches.forEach(key => {
                        // Render matches as cards
                        const card = document.createElement('div');
                        card.className = 'unit-card';
                        card.textContent = key; // Simple text for search
                        card.onclick = () => {
                            selectedJson = key;
                            initQuiz().then(() => saveProgress());
                        };
                        gridContainer.appendChild(card);
                    });
                };
            }

            // Search Expansion Logic
            const searchIconBtn = document.getElementById('searchIconBtn');
            const searchCloseBtn = document.getElementById('searchCloseBtn');
            const searchContainer = document.querySelector('.search-container');

            if (searchIconBtn && searchContainer) {
                searchIconBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isExpanded = searchContainer.classList.contains('expanded');
                    if (isExpanded) {
                        searchInput.focus();
                    } else {
                        searchContainer.classList.add('expanded');
                        searchInput.focus();
                    }
                };

                // Close Button Logic
                if (searchCloseBtn) {
                    searchCloseBtn.onclick = (e) => {
                        e.stopPropagation();
                        searchInput.value = '';
                        // Trigger input event to reset list
                        searchInput.dispatchEvent(new Event('input'));
                        searchContainer.classList.remove('expanded');
                    };
                }

                // Close when clicking outside
                document.addEventListener('click', (e) => {
                    if (!searchContainer.contains(e.target) && !searchInput.value) {
                        searchContainer.classList.remove('expanded');
                    }
                });
            }

            // Initial render
            renderFolderTiles();

        } else {
            document.getElementById('units-grid').innerHTML = '<p>No quizzes found.</p>';
        }
    } catch (error) {
        console.error('Failed to fetch quiz list:', error);
    }
}


window.addEventListener('DOMContentLoaded', fetchQuizList);

// Quiz upload handling (modal-based)
const uploadModal = document.getElementById('uploadModal');
const uploadNameInput = document.getElementById('uploadNameInput');
const uploadConfirmBtn = document.getElementById('uploadConfirmBtn');
let pendingQuizData = null;
// Removed standalone addQuizBtn logic; use controls menu item instead
const uploadInput = document.getElementById('uploadJson');
const pasteJson = document.getElementById('pasteJson');
const fileDropZone = document.getElementById('fileDropZone');
const dropZoneLabel = document.getElementById('dropZoneLabel');
const uploadModeRadios = uploadModal.querySelectorAll('input[name="upload-mode"]');

function openUploadModal(defaultMode = 'paste') {
    if (!uploadModal || !pasteJson || !fileDropZone || !uploadNameInput) return;
    uploadModal.style.display = 'flex';
    uploadModeRadios.forEach(r => r.checked = r.value === defaultMode);
    if (defaultMode === 'file') {
        pasteJson.style.display = 'none';
        fileDropZone.style.display = 'block';
    } else {
        pasteJson.style.display = 'block';
        fileDropZone.style.display = 'none';
    }
    pasteJson.value = '';
    uploadNameInput.value = '';
    pendingQuizData = null;
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
    });
});

// Click to open file selector
fileDropZone.addEventListener('click', () => uploadInput.click());
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
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
        try {
            const text = await file.text();
            pendingQuizData = JSON.parse(text);
            uploadNameInput.value = '';
            uploadModeRadios.forEach(r => r.checked = r.value === 'file');
            pasteJson.style.display = 'none';
            fileDropZone.style.display = 'block';
            dropZoneLabel.innerText = file.name;
            uploadModal.style.display = 'flex';
        } catch {
            showCustomAlert('JSON 格式錯誤，請檢查檔案');
        }
    } else {
        showCustomAlert('請提供 JSON 檔案');
    }
});

// When a file is selected, parse it and show modal
uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        pendingQuizData = JSON.parse(text);
    } catch {
        showCustomAlert('JSON 格式錯誤，請檢查檔案');
        return;
    }
    uploadNameInput.value = '';
    // If modal not open, open it and set mode to file
    uploadModal.style.display = 'flex';
    uploadModeRadios.forEach(r => r.checked = r.value === 'file');
    document.getElementById('pasteSection').style.display = 'none';
    fileDropZone.style.display = 'block';
    dropZoneLabel.innerText = file.name;
});

// Confirm upload: handle according to mode
uploadConfirmBtn.addEventListener('click', async () => {
    const quizName = uploadNameInput.value.trim();
    if (!quizName) {
        showCustomAlert('請輸入題庫名稱');
        return;
    }
    // Determine mode
    const mode = Array.from(uploadModeRadios).find(r => r.checked)?.value || 'paste';
    let quizData = null;
    if (mode === 'paste') {
        try {
            quizData = JSON.parse(pasteJson.value);
        } catch {
            showCustomAlert('請貼上正確的 JSON 內容');
            return;
        }
    } else {
        if (!pendingQuizData) {
            showCustomAlert('請選擇 JSON 檔案');
            return;
        }
        quizData = pendingQuizData;
    }
    const updates = {};
    updates[quizName] = quizData;
    try {
        await update(ref(database, '/'), updates);
        showCustomAlert('題庫已新增：' + quizName);
        fetchQuizList();
    } catch (err) {
        console.error(err);
        showCustomAlert('請跟管理員取得權限，或是檔案格式錯誤');
    }
    pendingQuizData = null;
    uploadModal.style.display = 'none';
    uploadInput.value = '';
    pasteJson.value = '';
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
    if (!userQuestion) {
        return;
    }
    inputSection.style.display = 'none';
    const defaultAnswer = currentQuestion.answer;
    const question = currentQuestion.question;
    const options = currentQuestion.options;
    currentQuestion.explanation = '<span class="typing-effect">正在等待 Gemini 回應...</span>';
    document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);

    let fetchedApiKey;
    try {
        const apiKeySnapshot = await get(ref(database, 'API_KEY'));
        if (!apiKeySnapshot.exists() || typeof apiKeySnapshot.val() !== 'string' || apiKeySnapshot.val().trim() === '') {
            showCustomAlert('錯誤：無法獲取有效的 API 金鑰。請洽管理員設定。');
            currentQuestion.explanation = '無法取得 API 金鑰，請聯繫管理員。';
            document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
            userQuestionInput.value = ''; // Clear input
            return;
        }
        fetchedApiKey = apiKeySnapshot.val();
    } catch (dbError) {
        console.error('從 Firebase 讀取 API Key 失敗:', dbError);
        showCustomAlert('讀取 API 金鑰時發生錯誤，請檢查網路連線或洽管理員。');
        currentQuestion.explanation = '讀取 API 金鑰時發生錯誤，請稍後再試。';
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        userQuestionInput.value = ''; // Clear input
        return;
    }

    const MODEL_NAME = 'gemini-flash-lite-latest';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${fetchedApiKey}`;

    const systemInstructionText = "使用正體中文（臺灣）或英文回答。回答我的提問，我的提問內容會是基於我提問後面所附的題目，但那個題目並非你主要要回答的內容。回應請使用Markdown格式排版，所有Markdown語法都可以使用。請不要上網搜尋。Simplified Chinese and pinyin are STRICTLY PROHIBITED. Do not include any introductory phrases or opening remarks.";

    const optionsText = Array.isArray(options) && options.length > 0
        ? options.map(opt => `「${opt}」`).join('、')
        : Object.keys(options || {}).length > 0 // Check if options is an object with keys
            ? Object.entries(options).map(([key, value]) => `${key}: 「${value}」`).join('；')
            : '（這題沒有提供選項）';


    const prompt = `好啦，這有個鳥問題：
題目：「${question}」
選項有：${optionsText}
他們說正確答案是：「${defaultAnswer}」
但我想問說「${userQuestion}」，`;

    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        system_instruction: {
            parts: [{
                text: systemInstructionText
            }]
        },
        safety_settings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ],
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Gemini API 噴錯了:', errorData);
            let errMsg = `API 請求失敗，狀態碼：${response.status}`;
            if (errorData.error && errorData.error.message) {
                errMsg += `，詳細資訊：${errorData.error.message}`;
            }
            throw new Error(errMsg);
        }

        const result = await response.json();
        let explanation = '幹，Gemini 好像又罷工了... 🙄';

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            explanation = result.candidates[0].content.parts[0].text;
        } else if (result.promptFeedback && result.promptFeedback.blockReason) {
            explanation = `操！就算叫你不要篩，你還是擋我？被 Gemini 大神擋下來了！原因：${result.promptFeedback.blockReason} 🤬`;
            if (result.promptFeedback.safetyRatings) {
                explanation += ` 安全評分：${JSON.stringify(result.promptFeedback.safetyRatings)}`;
            }
        } else if (result.candidates && result.candidates.length > 0 && result.candidates[0].finishReason === "SAFETY") {
            explanation = `幹！Gemini 因為安全理由拒絕回答，就算我叫他不要篩也一樣！媽的！ 安全評分：${JSON.stringify(result.candidates[0].safetyRatings)} 🖕`;
        }

        currentQuestion.explanation = explanation;
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        renderLatex(document.getElementById('explanation-text'));
        userQuestionInput.value = '';
        console.log('Gemini 回應更新成功啦！爽喔！🚀');

    } catch (error) {
        console.error('呼叫 Gemini API 的時候又他媽的炸裂了:', error);
        currentQuestion.explanation = `幹拎老師，呼叫 Gemini API 時噴了個大錯誤：${error.message} 💩。媽的，這預覽版模型是不是有問題啊！`;
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        renderLatex(document.getElementById('explanation-text'));
    } finally {
        // inputSection.style.display = 'block'; // 看你要不要加回來
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
    if (!auth.currentUser) return;
    const progress = {
        questions,
        currentQuestion,
        correct,
        wrong,
        questionHistory,
        selectedJson
    };
    update(ref(database, `progress/${auth.currentUser.uid}`), { progress })
        .catch(error => console.error('保存進度到 Firebase 失敗：', error));
}

function updateProgressBar(isCorrect = null) {
    const correctBar = document.getElementById('correctBar');
    const wrongBar = document.getElementById('wrongBar');

    if (initialQuestionCount > 0) {
        correctBar.style.width = (correct / initialQuestionCount * 100) + '%';
        wrongBar.style.width = (wrong / initialQuestionCount * 100) + '%';
    } else {
        correctBar.style.width = '0%';
        wrongBar.style.width = '0%';
    }

    // Add challenge animations
    if (isCorrect === true) {
        correctBar.classList.add('correct-animating');
        setTimeout(() => {
            correctBar.classList.remove('correct-animating');
        }, 800);
    } else if (isCorrect === false) {
        wrongBar.classList.add('wrong-animating');
        setTimeout(() => {
            wrongBar.classList.remove('wrong-animating');
        }, 800);
    }

    // Add general animation for both bars
    correctBar.classList.add('animating');
    wrongBar.classList.add('animating');
    setTimeout(() => {
        correctBar.classList.remove('animating');
        wrongBar.classList.remove('animating');
    }, 600);
}

function restoreProgress() {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能恢復進度！');
        return;
    }
    get(ref(database, `progress/${auth.currentUser.uid}/progress`)).then(snapshot => {
        if (!snapshot.exists()) {
            showCustomAlert('沒有找到已保存的進度！');
            return;
        }
        const p = snapshot.val();
        questions = p.questions;
        currentQuestion = p.currentQuestion;
        correct = p.correct;
        wrong = p.wrong;
        questionHistory = p.questionHistory;
        selectedJson = p.selectedJson;
        document.querySelector('.start-screen').style.display = 'none';
        document.querySelector('.quiz-container').style.display = 'flex';
        const fileName = selectedJson.split('/').pop().replace('.json', '');
        document.querySelector('.quiz-title').innerText = `${fileName}`;
        document.title = `${fileName} - 題矣`;
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;
        // Recalculate total questions for progress bar
        initialQuestionCount = questions.length + correct + wrong;
        updateProgressBar();
        loadQuestionFromState();
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

if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
        if (auth.currentUser) {
            const shouldSignOut = confirm('要登出 Google 帳號嗎？');
            if (!shouldSignOut) {
                return;
            }
            try {
                await signOut(auth);
                showCustomAlert('已登出 Google 帳號。');
            } catch (error) {
                console.error('Sign-out failed:', error);
                showCustomAlert('登出失敗，請稍後再試。');
            }
            return;
        }

        try {
            await signInWithRedirect(auth, googleProvider);
        } catch (error) {
            console.error('Google sign-in failed:', error);
            showCustomAlert('登入請求失敗，請稍後再試。');
        }
    });
}


// Delegate click to close any modal when '×' is clicked
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-close')) {
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
const menuAddQuiz = document.getElementById('menuAddQuiz');

if (controlsMenuBtn && controlsMenu) {
    controlsMenuBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // If not logged in, this button acts as the sign-in trigger
        if (!auth.currentUser) {
            try {
                await signInWithRedirect(auth, googleProvider);
            } catch (error) {
                console.error('Google sign-in failed:', error);
                showCustomAlert('登入請求失敗，請稍後再試。');
            }
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
onAuthStateChanged(auth, (user) => {
    updateSignInButton(user);
    syncControlsUser(user);
    updateRestorePreview(user);
});

updateSignInButton(auth.currentUser);
syncControlsUser(auth.currentUser);
updateRestorePreview(auth.currentUser);

// Controls item actions (text-only click)
if (menuStarred) menuStarred.addEventListener('click', () => {
    controlsMenu.classList.remove('open');
    if (showStarredBtn) openStarredModal();
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
let isEditMode = false;

if (menuEditQuizName) menuEditQuizName.addEventListener('click', () => {
    isEditMode = !isEditMode;
    toggleEditModeUI();
    if (typeof controlsMenu !== 'undefined' && controlsMenu) controlsMenu.classList.remove('open');
});

// Open upload modal from controls menu
if (menuAddQuiz) menuAddQuiz.addEventListener('click', () => {
    if (controlsMenu) controlsMenu.classList.remove('open');
    openUploadModal('paste');
});

function toggleEditModeUI() {
    const grid = document.getElementById('units-grid');
    if (grid && menuEditQuizName) {
        if (isEditMode) {
            grid.classList.add('edit-mode');
            menuEditQuizName.textContent = '停止編輯名稱';
        } else {
            grid.classList.remove('edit-mode');
            menuEditQuizName.textContent = '編輯題庫名稱';
        }
    }
}

async function handleRenameQuiz(oldName) {
    const newName = prompt(`請輸入「${oldName}」的新名稱:`, oldName);
    if (newName && newName.trim() !== '' && newName !== oldName) {
        try {
            // Get old data
            const snapshot = await get(ref(database, oldName));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const updates = {};
                updates[oldName] = null; // Delete old
                updates[newName.trim()] = data; // Set new

                await update(ref(database), updates);
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


// Initialize shuffle state label in menu on load
updateShuffleUI();

function loadQuestionFromState() {
    if (!currentQuestion || !currentQuestion.question) {
        showEndScreen();
        return;
    }
    updateStarIcon();
    updateStarIcon();
    const questionEl = document.getElementById('question');
    questionEl.innerHTML = marked.parse(currentQuestion.question);
    renderLatex(questionEl);

    if (currentQuestion.isFillBlank) {
        document.getElementById('options').style.display = 'none';
        fillblankContainer.style.display = 'flex';
        fillblankInput.value = ''; // Reset or restore if needed
        fillblankInput.disabled = false;
        fillblankInput.classList.remove('correct', 'incorrect');
    } else if (currentQuestion.options && Object.keys(currentQuestion.options).length > 0) {
        document.getElementById('options').style.display = 'flex';
        fillblankContainer.style.display = 'none';
        const optionsContainer = document.getElementById('options');
        optionsContainer.innerHTML = '';

        let optionEntriesToDisplay = Object.entries(currentQuestion.options);

        const isTrueFalse = optionEntriesToDisplay.length === 2 &&
            optionEntriesToDisplay.every(entry => ['T', 'F'].includes(entry[0]));

        if (shouldShuffleQuiz && !isTrueFalse) {
            shuffle(optionEntriesToDisplay); // Shuffle display order of A,B,C... buttons
        } else {
            // Ensure fixed order (A,B,C... or T,F)
            optionEntriesToDisplay.sort((a, b) => {
                if (isTrueFalse) { // Specific T,F order
                    if (a[0] === 'T' && b[0] === 'F') return -1; // T before F
                    if (a[0] === 'F' && b[0] === 'T') return 1;  // F after T
                    return 0;
                }
                return a[0].localeCompare(b[0]); // Alphabetical for A,B,C...
            });
        }

        optionEntriesToDisplay.forEach(([key, value]) => {
            const button = document.createElement('button');
            button.classList.add('option-button');
            button.dataset.option = key;
            button.innerHTML = marked.parse(`${key}: ${value}`);
            renderLatex(button); // Render LaTeX in options
            button.addEventListener('click', selectOption);
            optionsContainer.appendChild(button);
        });
    } else {
        document.getElementById('options').style.display = 'none';
        fillblankContainer.style.display = 'none';
    }

    // Update popup window content (Debug modal)
    // Update popup window content (Debug modal) - Safe check
    const popupWindow = document.getElementById('popupWindow');
    if (popupWindow) {
        const qEl = popupWindow.querySelector('.editable:nth-child(2)');
        const oEl = popupWindow.querySelector('.editable:nth-child(3)');
        const aEl = popupWindow.querySelector('.editable:nth-child(5)');
        const eEl = popupWindow.querySelector('.editable:nth-child(7)');

        if (qEl) qEl.innerText = currentQuestion.question;

        if (oEl) {
            const optionsText = Object.entries(currentQuestion.options || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
            oEl.innerText = optionsText;
        }

        if (aEl) {
            aEl.innerText = Array.isArray(currentQuestion.answer) ? currentQuestion.answer.join(', ') : currentQuestion.answer;
        }

        if (eEl) {
            eEl.innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！';
        }
    }

    if (currentQuestion.explanation) {
        document.getElementById('explanation').style.display = 'block';
        const originDisplay = document.getElementById('origin-display');
        if (currentQuestion.origin) {
            originDisplay.textContent = currentQuestion.origin;
            originDisplay.style.display = 'block';
        } else {
            originDisplay.style.display = 'none';
        }
    } else {
        document.getElementById('explanation').style.display = 'none';
        document.getElementById('origin-display').style.display = 'none';
    }
}

const STAR_SHARP_PATH = '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>';

function setStarState(isFilled) {
    if (!starBtn) return;
    // We strictly use the sharp path. Visuals (Outline vs Filled) are handled by CSS based on .active class.
    // Ensure the SVG content is correct (idempotent check or just set it)
    const svg = starBtn.querySelector('svg');
    if (svg && svg.innerHTML !== STAR_SHARP_PATH) {
        svg.innerHTML = STAR_SHARP_PATH;
    }

    if (isFilled) {
        starBtn.classList.add('active');
    } else {
        starBtn.classList.remove('active');
    }
}

async function updateStarIcon() {
    if (!starBtn) return;
    if (!auth.currentUser) {
        setStarState(false);
        return;
    }
    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        const starred = snap.val() || [];
        const isStarred = starred.some(q => q.question === currentQuestion.question);
        setStarState(isStarred);
    } catch (e) {
        console.error('讀取收藏題目失敗', e);
    }
}

async function toggleStarCurrentQuestion() {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能收藏題目！');
        return;
    }
    const starredRef = ref(database, `progress/${auth.currentUser.uid}/starred`);
    const snap = await get(starredRef);
    let starred = snap.val() || [];
    const index = starred.findIndex(q => q.question === currentQuestion.question);

    // Optimistic UI update
    const isNowStarred = index < 0; // If not found, it will be starred
    setStarState(isNowStarred);

    if (index >= 0) {
        starred.splice(index, 1);
    } else {
        const sourceName = (selectedJson || '').split('/').pop().replace('.json', '');
        starred.push({ ...currentQuestion, source: sourceName });
    }
    await set(starredRef, starred);
}

async function openStarredModal() {
    if (!auth.currentUser) {
        showCustomAlert('請先登入才能查看收藏！');
        return;
    }
    starredListDiv.innerHTML = '';
    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        const starred = snap.val() || [];
        if (starred.length === 0) {
            starredListDiv.innerHTML = '<p>尚未收藏任何題目</p>';
        } else {
            starred.sort((a, b) => (a.source || '').localeCompare(b.source || ''));
            starred.forEach((q, idx) => {
                const item = document.createElement('div');
                item.classList.add('starred-item');

                const sourceDiv = document.createElement('div');
                sourceDiv.classList.add('starred-source');
                sourceDiv.textContent = `來源：${q.source || '未知題庫'}`;
                item.appendChild(sourceDiv);

                const questionDiv = document.createElement('div');
                questionDiv.classList.add('starred-question');
                questionDiv.innerHTML = marked.parse(q.question);
                item.appendChild(questionDiv);

                const optionsDiv = document.createElement('div');
                optionsDiv.classList.add('starred-options');
                optionsDiv.innerHTML = Object.entries(q.options || {}).map(([k, v]) => `<div>${k}: ${v}</div>`).join('');
                item.appendChild(optionsDiv);

                const explanationDiv = document.createElement('div');
                explanationDiv.classList.add('starred-explanation');
                explanationDiv.style.display = 'none';
                explanationDiv.innerHTML = marked.parse(q.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！');
                item.appendChild(explanationDiv);

                const controlsDiv = document.createElement('div');
                controlsDiv.classList.add('starred-controls');

                const toggleBtn = document.createElement('button');
                toggleBtn.classList.add('toggle-explanation-button');
                toggleBtn.innerHTML = '<span class="button-text">顯示詳解</span><span class="arrow">▾</span>';
                toggleBtn.addEventListener('click', () => {
                    const showing = explanationDiv.style.display !== 'none';
                    explanationDiv.style.display = showing ? 'none' : 'block';
                    toggleBtn.querySelector('.button-text').textContent = showing ? '顯示詳解' : '隱藏詳解';
                    toggleBtn.querySelector('.arrow').textContent = showing ? '▾' : '▴';
                });
                controlsDiv.appendChild(toggleBtn);

                const delBtn = document.createElement('button');
                delBtn.classList.add('starred-delete-button');
                delBtn.textContent = '刪除';
                delBtn.addEventListener('click', async () => {
                    const newList = starred.filter((_, i) => i !== idx);
                    await set(ref(database, `progress/${auth.currentUser.uid}/starred`), newList);
                    openStarredModal();
                });
                controlsDiv.appendChild(delBtn);

                item.appendChild(controlsDiv);

                starredListDiv.appendChild(item);

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
    starredModal.style.display = 'flex';
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
        // 如果沒有儲存的設定，使用系統偏好
        isDarkMode = getSystemThemePreference();
    }
    applyTheme();
}

// 應用主題
function updateMenuThemeLabel() {
    if (typeof menuTheme !== 'undefined' && menuTheme) {
        menuTheme.textContent = isDarkMode ? '淺色模式' : '深色模式';
    }
}

function applyTheme() {
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    } else {
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
    watchSystemTheme();

    // 綁定切換按鈕事件
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
    }
}

// 頁面載入完成後初始化主題
document.addEventListener('DOMContentLoaded', initTheme);


/* Mistake Tracking Logic */
const mistakeButton = document.getElementById('mistakeButton');
const mistakeView = document.getElementById('mistakeView');
const closeMistakeViewBtn = document.getElementById('closeMistakeViewBtn');
const mistakeListContent = document.getElementById('mistakeListContent');

if (mistakeButton) {
    mistakeButton.addEventListener('click', () => {
        if (!auth.currentUser) {
            showCustomAlert('請先登入才能查看錯題紀錄！');
            return;
        }
        openMistakeView();
    });
}

if (closeMistakeViewBtn) {
    closeMistakeViewBtn.addEventListener('click', () => {
        closeMistakeView();
    });
}

function closeMistakeView() {
    if (mistakeView) {
        mistakeView.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

function recordMistake() {
    if (!auth.currentUser || !currentQuestion || !selectedJson) return;
    try {
        const quizName = selectedJson.split('/').pop().replace('.json', '');
        // Sanitize key: replacing '/' is critical as it creates sub-paths in Firebase
        const qKey = btoa(unescape(encodeURIComponent(currentQuestion.question)))
            .replace(/\//g, '_')
            .replace(/\+/g, '-');
        const userMistakeRef = ref(database, `mistakes/${auth.currentUser.uid}/${quizName}/${qKey}`);

        get(userMistakeRef).then((snapshot) => {
            let currentData = snapshot.val() || {};

            // Always update/ensure these fields are present and current
            currentData.question = currentQuestion.question;
            currentData.options = currentQuestion.options || null;
            currentData.answer = currentQuestion.answer;
            currentData.explanation = currentQuestion.explanation;
            currentData.origin = currentQuestion.origin || null; // Capture Origin
            currentData.isMultiSelect = currentQuestion.isMultiSelect || false;
            currentData.isFillBlank = currentQuestion.isFillBlank || false;

            currentData.count = (currentData.count || 0) + 1;
            currentData.lastMistake = Date.now();

            update(userMistakeRef, currentData);
        }).catch(err => console.error('Error recording mistake:', err));
    } catch (e) {
        console.error('Encoding error or other:', e);
    }
}

async function openMistakeView() {
    if (!auth.currentUser || !selectedJson) return;
    if (mistakeListContent) mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">載入中...</p>';
    if (mistakeView) {
        mistakeView.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Lock background scrolling
    }

    try {
        const quizName = selectedJson.split('/').pop().replace('.json', '');
        const snapshot = await get(ref(database, `mistakes/${auth.currentUser.uid}/${quizName}`));

        if (!snapshot.exists()) {
            if (mistakeListContent) mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">本單元目前沒有錯題紀錄。</p>';
            return;
        }

        const data = snapshot.val();

        // Recursive helper to extract mistake objects from potentially nested structure (due to old unsanitized keys)
        const mistakes = [];
        const extractMistakes = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            // Check if this object looks like a mistake record
            if (obj.question && (typeof obj.count === 'number' || obj.lastMistake)) {
                mistakes.push(obj);
                // Don't return here if we want to support nested mistakes inside mistakes (unlikely but safe)
                // But usually a leaf node mistake won't contain other mistakes.
                return;
            }
            // Otherwise, recurse into children
            Object.values(obj).forEach(child => extractMistakes(child));
        };

        extractMistakes(data);

        mistakes.sort((a, b) => (b.count || 0) - (a.count || 0));

        if (mistakeListContent) {
            mistakeListContent.innerHTML = '';
            mistakes.forEach(m => {
                const div = document.createElement('div');
                div.className = 'mistake-item';

                // Header: Question + Badge
                const headerRow = document.createElement('div');
                headerRow.className = 'mistake-item-header';

                const info = document.createElement('div');
                info.className = 'mistake-info';
                // Safe parsing check
                if (typeof m.question === 'string') {
                    info.innerHTML = marked.parse(m.question);
                } else {
                    info.innerHTML = '<i>(題目載入錯誤)</i>';
                }

                const badge = document.createElement('div');
                badge.className = 'mistake-count-badge';
                badge.textContent = `${m.count} 次錯誤`;

                headerRow.appendChild(info);
                headerRow.appendChild(badge);
                div.appendChild(headerRow);

                // Details: Options (if any)
                if (m.options && typeof m.options === 'object') {
                    const optionsDiv = document.createElement('div');
                    optionsDiv.className = 'mistake-options';

                    let optionsHtml = '<ul>';
                    Object.entries(m.options).forEach(([key, val]) => {
                        const isAns = Array.isArray(m.answer)
                            ? m.answer.includes(key)
                            : m.answer === key;
                        const styleClass = isAns ? 'class="correct-option"' : '';
                        optionsHtml += `<li ${styleClass}>${key}: ${val}</li>`;
                    });
                    optionsHtml += '</ul>';
                    optionsDiv.innerHTML = optionsHtml;
                    div.appendChild(optionsDiv);
                }

                // Details: Answer & Explanation
                const ansExpDiv = document.createElement('div');
                ansExpDiv.className = 'mistake-details';

                let ansText = Array.isArray(m.answer) ? m.answer.join(', ') : m.answer;

                let explanationHtml = '';
                if (m.explanation && typeof m.explanation === 'string') {
                    explanationHtml = marked.parse(m.explanation);
                } else {
                    explanationHtml = '<i>暫無詳解</i>';
                }

                // Origin Tag (if exists)
                let originHtml = '';
                if (m.origin) {
                    originHtml = `<div class="mistake-origin-row">出處：${m.origin}</div>`;
                }

                ansExpDiv.innerHTML = `
                    <div class="mistake-explanation-row"><strong>詳解:</strong> ${explanationHtml}</div>
                    ${originHtml}
                `;

                div.appendChild(ansExpDiv);

                // Latex render
                renderLatex(div);

                mistakeListContent.appendChild(div);
            });
        }

    } catch (err) {
        console.error('Error fetching mistakes:', err);
        if (mistakeListContent) mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">載入失敗，請稍後再試。</p>';
    }
}
