// Firebase SDK imports and initialization (v11.6.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getDatabase, ref, get, update, set, remove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

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
        
        const fileName = (p.selectedJson || '').split('/').pop().replace('.json', '') || '最近的中斷點';
        
        let total = 0;
        let done = 0;
        if (p.allQuestions) {
            total = p.allQuestions.length;
            done = p.currentIndex;
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
let userMistakesCache = {};

// 獲取唯一的錯題與收藏存儲鍵名（包含科目與習題名稱）
function getQuizStorageName(path) {
    if (!path) return 'default';
    
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
    
    // Process and shuffle allQuestions
    allQuestions = JSON.parse(JSON.stringify(questions));
    if (shouldShuffleQuiz) {
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
                shouldShuffleOptionContent = shouldShuffleQuiz;
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
            for (let i = 0; i < optionEntries.length; i++) {
                const [originalLabel, _] = optionEntries[i];
                labelMapping[originalLabel] = optionLabels[i];
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
    currentIndex++;
    if (currentIndex >= allQuestions.length) {
        stopTimer();
        showEndScreen();
        return;
    }
    viewingIndex = currentIndex;
    selectedOption = null;
    selectedOptions = [];
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
        
        if (q.isAnswered) {
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

    currentQuestion = q; // Update currentQuestion globally

    const confirmBtn = document.getElementById('confirm-btn');
    const nextBtn = document.getElementById('next-btn');
    const backBtn = document.getElementById('back-progress-btn');
    const backBtnExpl = document.getElementById('back-progress-btn-expl');

    document.getElementById('WeeGPTInputSection').style.display = 'none';
    updateStarIcon();

    const questionDiv = document.getElementById('question');
    const questionHtml = marked.parse(q.question);
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

        if (q.isConfirmed) {
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
            button.innerHTML = marked.parse(`${key}: ${value}`);
            renderLatex(button);

            if (q.isConfirmed) {
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
        document.getElementById('explanation-text').innerHTML = marked.parse(q.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！');
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
    const q = allQuestions[currentIndex];
    if (!q) return;

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
                showCustomAlert('選點啥吧，用猜的也好！');
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
                showCustomAlert('選點啥吧，用猜的也好！');
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
    correct += 1;
    document.getElementById('correct').innerText = correct;
    updateProgressBar(true);
}

function updateWrong() {
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
    updateProgressBar(false);
    recordMistake();
}

function showEndScreen() {
    isTestCompleted = true;
    
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

    // Celebration Graphic (SVG instead of emoji)
    const graphic = document.createElement('div');
    graphic.className = 'results-graphic';
    graphic.innerHTML = `
        <svg class="check-animation" viewBox="0 0 52 52">
            <circle class="check-circle" cx="26" cy="26" r="25" fill="none"/>
            <path class="check-mark" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
        </svg>
    `;
    container.appendChild(graphic);

    const title = document.createElement('h1');
    title.className = 'results-title';
    title.innerText = '測驗結幕';
    container.appendChild(title);

    const fileName = selectedJson ? selectedJson.split('/').pop().replace('.json', '') : '';
    const subtitle = document.createElement('p');
    subtitle.className = 'results-subtitle';
    subtitle.innerText = fileName;
    container.appendChild(subtitle);

    // Stats Grid
    const statsGrid = document.createElement('div');
    statsGrid.className = 'results-stats-grid';

    const totalQuestions = correct + wrong;
    const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    statsGrid.innerHTML = `
        <div class="stat-card accuracy">
            <div class="stat-value">${accuracy}%</div>
            <div class="stat-label">正確率</div>
        </div>
        <div class="stat-card correct">
            <div class="stat-value">${correct}</div>
            <div class="stat-label">答對</div>
        </div>
        <div class="stat-card wrong">
            <div class="stat-value">${wrong}</div>
            <div class="stat-label">答錯</div>
        </div>
    `;
    container.appendChild(statsGrid);

    // Action Buttons
    const actionArea = document.createElement('div');
    actionArea.className = 'results-actions';

    // Redo Wrong Button
    const redoBtn = document.createElement('button');
    redoBtn.className = 'm3-btn m3-btn-filled';
    redoBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
        </svg>
        <span>重做錯題</span>
    `;
    const wrongList = allQuestions.filter(q => q.isAnswered && !q.isCorrect);
    if (wrongList.length === 0) {
        redoBtn.disabled = true;
    }
    redoBtn.addEventListener('click', () => {
        const wrongListToRedo = allQuestions.filter(q => q.isAnswered && !q.isCorrect);
        if (wrongListToRedo.length === 0) return;
        
        allQuestions = wrongListToRedo.map(q => {
            return {
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
                isConfirmed: false
            };
        });
        
        wrongQuestions = [];
        correct = 0;
        wrong = 0;
        currentIndex = 0;
        viewingIndex = 0;
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
    resetBtn.className = 'm3-btn m3-btn-outlined';
    resetBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
            <path d="M240-200h120v-240h240v240h120v-440L480-740 240-640v440Zm-80 80v-600l320-240 320 240v600H520v-240h-80v240H160Zm320-350Z"/>
        </svg>
        <span>重新選題庫</span>
    `;
    resetBtn.addEventListener('click', () => {
        location.reload();
    });
    actionArea.appendChild(resetBtn);

    container.appendChild(actionArea);
    endScreenDiv.appendChild(container);

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
document.getElementById('back-progress-btn').addEventListener('click', () => {
    renderQuestion(currentIndex);
});
document.getElementById('back-progress-btn-expl').addEventListener('click', () => {
    renderQuestion(currentIndex);
});

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
    if (selectedJson && !isTestCompleted) {
        event.preventDefault();
        event.returnValue = '';
    }
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
                    title.textContent = displayTitle;

                    // Archive Icon Logic
                    const archiveIcon = document.createElement('button');
                    archiveIcon.className = 'quiz-archive-btn';
                    archiveIcon.innerHTML = viewArchiveMode
                        ? `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M480-480ZM200-120v-520H80v-120h800v120H760v520H200Zm120-120h320v-400h120L480-840 280-640h120v400Zm160-200Z"/></svg>`
                        : `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor"><path d="M200-120v-520H80v-120h800v120H760v520H200Zm120-120h320v-400H320v400Zm160-40L600-400l-56-56-104 104v-208h-80v208L256-456l-56 56 200 120Z"/></svg>`;
                    archiveIcon.title = viewArchiveMode ? '取消典藏' : '典藏題庫';
                    archiveIcon.onclick = (e) => {
                        e.stopPropagation();
                        handleArchiveQuiz(key);
                    };
                    card.appendChild(archiveIcon);

                    infoDiv.appendChild(title);

                    const subtitle = document.createElement('div');
                    subtitle.className = 'unit-subtitle';
                    const qCount = data && Array.isArray(data[key]) ? data[key].length : 0;
                    subtitle.textContent = `共 ${qCount} 題`;
                    infoDiv.appendChild(subtitle);

                    // Add progress indicator to card if cache has progress
                    const quizStorageName = getQuizStorageName(key);
                    const p = userProgressCache[quizStorageName];
                    let progressText = '';
                    let isCompleted = false;
                    let percent = 0;
                    
                    if (p) {
                        const total = p.allQuestions ? p.allQuestions.length : 0;
                        const done = p.currentIndex;
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

                    const progressContainer = document.createElement('div');
                    progressContainer.className = 'unit-progress-container';
                    if (isCompleted) {
                        progressContainer.innerHTML = `
                            <span class="unit-progress-text completed">
                                <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor" style="vertical-align: text-bottom; margin-right: 4px;">
                                    <path d="m382-320 338-338-57-57-281 281-123-122-57 57 180 180Z"/>
                                </svg>已完成
                            </span>
                        `;
                        card.classList.add('completed');
                    } else if (percent > 0) {
                        progressContainer.innerHTML = `
                            <span class="unit-progress-text">${progressText}</span>
                            <div class="unit-progress-bar">
                                <div class="unit-progress-fill" style="width: ${percent}%"></div>
                            </div>
                        `;
                    }
                    infoDiv.appendChild(progressContainer);

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
                        
                        startFreshQuiz(key);
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
    if (!auth.currentUser || !selectedJson) return;
    const quizName = getQuizStorageName(selectedJson);
    const progress = {
        allQuestions,
        currentIndex,
        selectedJson,
        lastUpdated: Date.now()
    };
    userProgressCache[quizName] = progress;
    update(ref(database, `progress/${auth.currentUser.uid}/quizzes/${quizName}`), progress)
        .catch(error => console.error('保存進度到 Firebase 失敗：', error));

    update(ref(database, `progress/${auth.currentUser.uid}/lastActive`), {
        quizName,
        selectedJson,
        lastUpdated: Date.now()
    }).catch(error => console.error('更新最後活動失敗：', error));
}

function updateProgressBar(isCorrect = null) {
    updateDotsUI();
}

function restoreProgress(quizName = null) {
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
        return get(ref(database, `progress/${auth.currentUser.uid}/quizzes/${resolvedQuizName}`));
    }).then(snapshot => {
        if (!snapshot.exists()) {
            showCustomAlert('沒有找到已保存的進度！');
            return;
        }
        const p = snapshot.val();
        
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
        
        viewingIndex = currentIndex;
        
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
        correct = cCount;
        wrong = wCount;
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
            console.log('Starting Google Sign-In with Popup...');
            const result = await signInWithPopup(auth, googleProvider);
            console.log('Google Sign-In success, user:', result.user);
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
                console.log('Starting Google Sign-In with Popup (from controls menu)...');
                const result = await signInWithPopup(auth, googleProvider);
                console.log('Google Sign-In success (from controls menu), user:', result.user);
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
onAuthStateChanged(auth, async (user) => {
    console.log('Auth state changed, user:', user ? user.displayName : 'Logged out');
    updateSignInButton(user);
    syncControlsUser(user);
    if (user) {
        await fetchUserProgressAndMistakes(user);
    } else {
        userProgressCache = {};
        userMistakesCache = {};
    }
    updateRestorePreview(user);
    fetchQuizList();
});

updateSignInButton(auth.currentUser);
syncControlsUser(auth.currentUser);

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
const menuArchived = document.getElementById('menuArchived');
let isEditMode = false;
let viewArchiveMode = false;
let currentActiveFolder = null;
let selectedQuizzesForBatch = [];
let globalQuizGroups = {};

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
                    
                    const snapshot = await get(ref(database, oldName));
                    if (snapshot.exists()) {
                        const data = snapshot.val();
                        updates[oldName] = null;
                        updates[newName] = data;
                    }
                }
                await update(ref(database), updates);
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
            // Get old data
            const snapshot = await get(ref(database, oldName));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const updates = {};
                updates[oldName] = null; // Delete old
                updates[newName] = data; // Set new

                await update(ref(database), updates);
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
            const snapshot = await get(ref(database, oldName));
            if (snapshot.exists()) {
                const data = snapshot.val();
                const updates = {};
                updates[oldName] = null;
                updates[newName] = data;
                await update(ref(database), updates);
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

        if (qEl) { qEl.innerHTML = marked.parse(currentQuestion.question); renderLatex(qEl); }
        if (oEl) {
            const optionsText = Object.entries(currentQuestion.options || {}).map(([k, v]) => `**${k}**: ${v}`).join('\n\n');
            oEl.innerHTML = marked.parse(optionsText);
            renderLatex(oEl);
        }
        if (aEl) { aEl.innerText = Array.isArray(currentQuestion.answer) ? currentQuestion.answer.join(', ') : currentQuestion.answer; }
        if (eEl) { eEl.innerHTML = marked.parse(currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini！'); renderLatex(eEl); }
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

    // Always reset first so we don't show the previous question's state while loading
    setStarState(false);

    if (!auth.currentUser) {
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
        const sourceName = getQuizStorageName(selectedJson);
        starred.push({ ...currentQuestion, source: sourceName });
    }
    await set(starredRef, starred);
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
            const promises = starred.map(async (q, idx) => {
                let mistakeCount = 0;
                if (q.source && q.question) {
                    try {
                        const qKey = btoa(unescape(encodeURIComponent(q.question)))
                            .replace(/\//g, '_')
                            .replace(/\+/g, '-');
                        const mSnap = await get(ref(database, `mistakes/${auth.currentUser.uid}/${q.source}/${qKey}/count`));
                        if (mSnap.exists()) {
                            mistakeCount = mSnap.val();
                        }
                    } catch (e) {
                        // ignore encoding errors
                    }
                }
                return { ...q, mistakeCount, originalIndex: idx };
            });

            const processedStarred = await Promise.all(promises);

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
                questionText.innerHTML = marked.parse(q.question);
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
<svg class="star-filled" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="#fbbc04"><path d="m233-80 65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Z"/></svg>
<svg class="star-empty" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="m354-247 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-80l65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Zm247-355Z"/></svg>
                `;

                starBtnLocal.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // Remove from list
                    // Use the original list to filter out
                    // Note: 'starred' variable inside is from closure, but we can re-read or just filter current visual list
                    // Better to re-read to be safe or filter in memory
                    try {
                        const newList = starred.filter(item => item.question !== q.question);
                        await set(ref(database, `progress/${auth.currentUser.uid}/starred`), newList);
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
                        const parsedOpt = marked.parse(`${k}: ${v}`).trim();
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
                let ansText = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;

                // Explanation text
                let expText = q.explanation ? marked.parse(q.explanation) : '<i>暫無詳解</i>';

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


/* Mistake Tracking Logic */
const mistakeView = document.getElementById('mistakeView');
const closeMistakeViewBtn = document.getElementById('closeMistakeViewBtn');
const mistakeListContent = document.getElementById('mistakeListContent');

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
        const quizName = getQuizStorageName(selectedJson);
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

            // Update local cache
            if (!userMistakesCache[quizName]) {
                userMistakesCache[quizName] = {};
            }
            userMistakesCache[quizName][qKey] = currentData;

            update(userMistakeRef, currentData);
        }).catch(err => console.error('Error recording mistake:', err));
    } catch (e) {
        console.error('Encoding error or other:', e);
    }
}

let mistakesViewState = 'folders'; // 'folders' | 'quizzes' | 'items'
let currentMistakesFolder = null;
let currentMistakesQuizName = null;

async function openMistakeView(targetQuizName = null) {
    if (!auth.currentUser) return;
    
    const viewTitle = document.getElementById('mistakeViewTitle');
    const backBtn = document.getElementById('backMistakeViewBtn');
    
    if (mistakeView) {
        mistakeView.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    
    if (targetQuizName) {
        // View specific quiz mistakes
        mistakesViewState = 'items';
        currentMistakesQuizName = targetQuizName;
        if (backBtn) backBtn.style.display = 'block';
        
        let displayTitle = targetQuizName;
        const rawKey = Object.keys(userMistakesCache).find(k => getQuizStorageName(k) === targetQuizName) || targetQuizName;
        
        let cleanKey = rawKey;
        if (cleanKey.startsWith('_Archive_')) cleanKey = cleanKey.substring(9);
        const idx = cleanKey.indexOf('｜');
        if (idx !== -1) {
            currentMistakesFolder = cleanKey.slice(0, idx);
            displayTitle = cleanKey.substring(idx + 1);
        } else {
            currentMistakesFolder = '其他';
            displayTitle = cleanKey;
        }
        
        if (viewTitle) viewTitle.textContent = displayTitle;
        
        await renderQuizMistakes(targetQuizName);
    } else {
        // View global folders list
        mistakesViewState = 'folders';
        currentMistakesFolder = null;
        currentMistakesQuizName = null;
        if (backBtn) backBtn.style.display = 'none';
        if (viewTitle) viewTitle.textContent = '錯題本';
        
        renderGlobalMistakesFolders();
    }
}

function openMistakesFolder(folderName) {
    mistakesViewState = 'quizzes';
    currentMistakesFolder = folderName;
    const viewTitle = document.getElementById('mistakeViewTitle');
    const backBtn = document.getElementById('backMistakeViewBtn');
    
    if (backBtn) backBtn.style.display = 'block';
    if (viewTitle) viewTitle.textContent = folderName;
    
    renderMistakesQuizzesList(folderName);
}

function getMistakesGrouped() {
    const folders = {}; // folderName -> Array of { quizKey, quizName, count }
    
    Object.keys(userMistakesCache).forEach(quizKey => {
        const quizName = getQuizStorageName(quizKey);
        if (hasMistakesRecorded(quizName)) {
            const mistakesData = userMistakesCache[quizKey];
            const mistakes = [];
            const extractMistakes = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.question) {
                    mistakes.push(obj);
                    return;
                }
                Object.values(obj).forEach(extractMistakes);
            };
            extractMistakes(mistakesData);
            
            if (mistakes.length > 0) {
                let cleanKey = quizKey;
                if (cleanKey.startsWith('_Archive_')) cleanKey = cleanKey.substring(9);
                const idx = cleanKey.indexOf('｜');
                const folderName = idx !== -1 ? cleanKey.slice(0, idx) : '其他';
                
                if (!folders[folderName]) {
                    folders[folderName] = [];
                }
                folders[folderName].push({
                    quizKey,
                    quizName,
                    count: mistakes.length
                });
            }
        }
    });
    return folders;
}

function renderGlobalMistakesFolders() {
    if (!mistakeListContent) return;
    mistakeListContent.innerHTML = '';
    
    const folders = getMistakesGrouped();
    const folderNames = Object.keys(folders).sort((a, b) => {
        if (a === '其他' && b !== '其他') return 1;
        if (b === '其他' && a !== '其他') return -1;
        return a.localeCompare(b, 'zh-Hant');
    });
    
    if (folderNames.length === 0) {
        mistakeListContent.innerHTML = '<p style="text-align:center; padding: 40px; color: var(--on-surface-variant);">目前沒有任何錯題紀錄！</p>';
        return;
    }
    
    folderNames.forEach(folderName => {
        let folderMistakeCount = 0;
        folders[folderName].forEach(q => {
            folderMistakeCount += q.count;
        });
        const count = folders[folderName].length;
        
        const item = document.createElement('div');
        item.className = 'global-mistake-card';
        
        item.innerHTML = `
            <div class="global-mistake-card-content">
                <div class="global-mistake-title">${folderName}</div>
                <div class="global-mistake-count">${count} 份習題 (共 ${folderMistakeCount} 個錯題)</div>
            </div>
            <svg class="arrow-icon" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/>
            </svg>
        `;
        
        item.onclick = () => {
            openMistakesFolder(folderName);
        };
        
        mistakeListContent.appendChild(item);
    });
}

function renderMistakesQuizzesList(folderName) {
    if (!mistakeListContent) return;
    mistakeListContent.innerHTML = '';
    
    const folders = getMistakesGrouped();
    const quizzes = folders[folderName] || [];
    
    if (quizzes.length === 0) {
        mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">此單元目前沒有錯題紀錄。</p>';
        return;
    }
    
    quizzes.sort((a, b) => a.quizKey.localeCompare(b.quizKey, 'zh-Hant'));
    
    quizzes.forEach(q => {
        const item = document.createElement('div');
        item.className = 'global-mistake-card';
        
        let displayTitle = q.quizKey;
        if (displayTitle.startsWith('_Archive_')) displayTitle = displayTitle.substring(9);
        const idx = displayTitle.indexOf('｜');
        if (idx !== -1) displayTitle = displayTitle.substring(idx + 1);
        
        item.innerHTML = `
            <div class="global-mistake-card-content">
                <div class="global-mistake-title">${displayTitle}</div>
                <div class="global-mistake-count">${q.count} 個錯題</div>
            </div>
            <svg class="arrow-icon" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/>
            </svg>
        `;
        
        item.onclick = () => {
            openMistakeView(q.quizName);
        };
        
        mistakeListContent.appendChild(item);
    });
}

async function renderQuizMistakes(quizName) {
    if (!mistakeListContent) return;
    mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">載入中...</p>';
    
    try {
        let data = userMistakesCache[quizName];
        if (!data) {
            const matchedKey = Object.keys(userMistakesCache).find(k => getQuizStorageName(k) === quizName);
            if (matchedKey) data = userMistakesCache[matchedKey];
        }
        
        if (!data) {
            const snap = await get(ref(database, `mistakes/${auth.currentUser.uid}/${quizName}`));
            data = snap.val();
        }
        
        if (!data) {
            mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">本單元目前沒有錯題紀錄。</p>';
            return;
        }
        
        const mistakes = [];
        const extractMistakes = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (obj.question) {
                let matchedQ = allQuestions.find(q => q.question === obj.question);
                if (matchedQ) {
                    if (!obj.options && matchedQ.options) obj.options = matchedQ.options;
                    if (!obj.answer && matchedQ.answer) obj.answer = matchedQ.answer;
                    if (!obj.explanation && matchedQ.explanation) obj.explanation = matchedQ.explanation;
                    if (!obj.origin && matchedQ.origin) obj.origin = matchedQ.origin;
                    if (obj.isMultiSelect === undefined) obj.isMultiSelect = matchedQ.isMultiSelect;
                    if (obj.isFillBlank === undefined) obj.isFillBlank = matchedQ.isFillBlank;
                }
                mistakes.push(obj);
                return;
            }
            Object.values(obj).forEach(child => extractMistakes(child));
        };
        
        extractMistakes(data);
        mistakes.sort((a, b) => (b.count || 0) - (a.count || 0));
        
        mistakeListContent.innerHTML = '';
        mistakes.forEach(m => {
            const div = document.createElement('div');
            div.className = 'mistake-item';
            
            const headerRow = document.createElement('div');
            headerRow.className = 'mistake-item-header';
            
            const info = document.createElement('div');
            info.className = 'mistake-info';
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
            
            if (m.options && typeof m.options === 'object') {
                const optionsDiv = document.createElement('div');
                optionsDiv.className = 'mistake-options';
                let optionsHtml = '<ul>';
                let entries = Object.entries(m.options);
                
                const isTrueFalse = entries.length === 2 && entries.every(entry => ['T', 'F'].includes(entry[0]));
                if (isTrueFalse) {
                    entries.sort((a, b) => {
                        if (a[0] === 'T') return -1;
                        if (b[0] === 'T') return 1;
                        return 0;
                    });
                }
                
                entries.forEach(([key, val]) => {
                    const isAns = Array.isArray(m.answer) ? m.answer.includes(key) : m.answer === key;
                    const styleClass = isAns ? 'class="correct-option"' : '';
                    const parsedOpt = marked.parse(`${key}: ${val}`).trim();
                    optionsHtml += `<li ${styleClass}>${parsedOpt}</li>`;
                });
                optionsHtml += '</ul>';
                optionsDiv.innerHTML = optionsHtml;
                div.appendChild(optionsDiv);
            }
            
            const ansExpDiv = document.createElement('div');
            ansExpDiv.className = 'mistake-details';
            
            let ansText = Array.isArray(m.answer) ? m.answer.join(', ') : m.answer;
            let expText = m.explanation ? marked.parse(m.explanation) : '<i>暫無詳解</i>';
            
            let detailsHtml = `
                <div style="margin-bottom:8px;"><strong>正確答案:</strong> ${ansText}</div>
                <div class="mistake-explanation-row"><strong>詳解:</strong> ${expText}</div>
            `;
            if (m.origin) {
                detailsHtml += `<div class="mistake-origin-row">出處：${m.origin}</div>`;
            }
            
            ansExpDiv.innerHTML = detailsHtml;
            div.appendChild(ansExpDiv);
            
            renderLatex(div);
            mistakeListContent.appendChild(div);
        });
        
    } catch (err) {
        console.error('Error rendering mistakes:', err);
        mistakeListContent.innerHTML = '<p style="text-align:center; padding: 20px;">載入失敗，請稍後再試。</p>';
    }
}

function hasMistakesRecorded(quizName) {
    const data = userMistakesCache[quizName];
    if (!data) return false;
    let found = false;
    const checkObj = (obj) => {
        if (!obj || typeof obj !== 'object' || found) return;
        if (obj.question) {
            found = true;
            return;
        }
        Object.values(obj).forEach(checkObj);
    };
    checkObj(data);
    return found;
}

function openQuizActionModal(key, progress) {
    const modal = document.getElementById('quizActionModal');
    const title = document.getElementById('quizActionTitle');
    const status = document.getElementById('quizActionStatus');
    const resumeBtn = document.getElementById('quizActionResumeBtn');
    const restartBtn = document.getElementById('quizActionRestartBtn');
    
    if (!modal) return;
    
    let displayTitle = key;
    if (displayTitle.startsWith('_Archive_')) displayTitle = displayTitle.substring(9);
    title.textContent = displayTitle;
    
    let statusText = '這是一個全新的測驗。';
    let showResume = false;
    let resumeText = '繼續測驗';
    let restartText = '開始測驗';
    
    if (progress) {
        const total = progress.allQuestions ? progress.allQuestions.length : 0;
        const done = progress.currentIndex;
        if (done >= total) {
            statusText = `您已完成此測驗（進度：${done}/${total}）。`;
            showResume = true;
            resumeText = '查看完整回顧';
            restartText = '重新挑戰';
        } else if (done > 0) {
            statusText = `上次測驗進行到第 ${done + 1} 題（進度：${done}/${total}）。`;
            showResume = true;
            resumeText = '繼續測驗';
            restartText = '重新開始';
        }
    }
    
    status.textContent = statusText;
    
    if (showResume) {
        resumeBtn.style.display = 'block';
        resumeBtn.querySelector('span').textContent = resumeText;
        resumeBtn.onclick = () => {
            closeQuizActionModal();
            selectedJson = key;
            restoreProgress(getQuizStorageName(key));
        };
    } else {
        resumeBtn.style.display = 'none';
    }
    
    restartBtn.querySelector('span').textContent = restartText;
    restartBtn.onclick = () => {
        closeQuizActionModal();
        startFreshQuiz(key);
    };
    
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeQuizActionModal() {
    const modal = document.getElementById('quizActionModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}

function startFreshQuiz(key) {
    selectedJson = key;
    document.querySelector('.start-screen').style.display = 'none';
    initQuiz().then(() => {
        saveProgress();
    });
}

async function fetchUserProgressAndMistakes(user) {
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
        
        userProgressCache = progressSnap.exists() ? progressSnap.val() : {};
        userMistakesCache = mistakesSnap.exists() ? mistakesSnap.val() : {};
    } catch (e) {
        console.error('Failed to fetch user progress/mistakes cache:', e);
        userProgressCache = {};
        userMistakesCache = {};
    }
}

// Global Mistakes bindings
const menuGlobalMistakes = document.getElementById('menuGlobalMistakes');
if (menuGlobalMistakes) menuGlobalMistakes.addEventListener('click', () => {
    controlsMenu.classList.remove('open');
    openMistakeView(null);
});

const backMistakeViewBtn = document.getElementById('backMistakeViewBtn');
if (backMistakeViewBtn) backMistakeViewBtn.addEventListener('click', () => {
    openMistakeView(null);
});

const quizActionCloseBtn = document.getElementById('quizActionCloseBtn');
if (quizActionCloseBtn) quizActionCloseBtn.addEventListener('click', () => {
    closeQuizActionModal();
});
