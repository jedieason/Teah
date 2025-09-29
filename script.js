// Firebase SDK imports and initialization (v11.6.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getDatabase, ref, get, update, set } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

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
const signInBtn = document.getElementById('signInBtn');

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
    for (let i = array.length -1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i +1));
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

        // 更新模態窗口的內容
        document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
        const optionsText = Object.entries(currentQuestion.options).map(([key, value]) => `${key}: ${value}`).join('\n');
        document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
        document.querySelector('#popupWindow .editable:nth-child(5)').innerText = currentQuestion.answer;
        document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';
    }
    saveProgress();
    updateProgressBar();
    updateStarIcon();
}

function updateExplanationOptions(explanation, labelMapping) {
    if (!explanation) {
        return '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';
    }
    // Regex to match (A), ( B ), （Ｃ）, （ D ）, (Ｅ), （F）, etc.
    // It allows for optional spaces between the parentheses (half-width or full-width)
    // and the letter (half-width or full-width A-L).
    return explanation.replace(/(?:\(|\uFF08)\s*([A-L\uFF21-\uFF2C])\s*(?:\)|\uFF09)/g, function(match, capturedLetter) {
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

function setModalMessage(message) {
    modalMessage.innerText = message;
}

function showCustomAlert(message) {
    setModalMessage(message);
    customAlert.style.display = 'flex';
}

function hideCustomAlert() {
    customAlert.style.display = 'none';
}

modalConfirmBtn.addEventListener('click', () => {
    hideCustomAlert();
    if (isTestCompleted) {
        location.reload();
    }
});

// 修改確認按鈕函數
function confirmAnswer() {
    // 處理填空題邏輯
    if (currentQuestion.isFillBlank) {
        const userInput = fillblankInput.value.trim();
        if (!userInput) {
            showCustomAlert('請輸入您的答案！');
            return;
        }
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
        renderMathInElement(document.getElementById('explanation-text'), {
            delimiters: [
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false },
                { left: "$$", right: "$$", display: true },
                { left: "\\[", right: "\\]", display: true }
            ]
        });
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
            acceptingAnswers = false;
            document.getElementById('confirm-btn').disabled = true;
            const selectedBtn = document.querySelector(`.option-button[data-option='${selectedOption}']`);
            if (selectedOption === currentQuestion.answer) {
                selectedBtn.classList.add('correct');
                updateCorrect();
            } else {
                selectedBtn.classList.add('incorrect');
                const correctBtn = document.querySelector(`.option-button[data-option='${currentQuestion.answer}']`);
                correctBtn.classList.add('correct');
                updateWrong();
            }
        }
        // 顯示詳解
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        renderMathInElement(document.getElementById('explanation-text'), {
            delimiters: [
                { left: "$", right: "$", display: false },
                { left: "\\(", right: "\\)", display: false },
                { left: "$$", right: "$$", display: true },
                { left: "\\[", right: "\\]", display: true }
            ]
        });
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
    navigator.clipboard.writeText(textToCopy).then(function() {
        showCustomAlert('題目已複製！');
    }, function(err) {
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
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！');
        renderMathInElement(document.getElementById('explanation-text'), {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });
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

    // Update popup window content (Debug modal)
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = Array.isArray(currentQuestion.answer) ? currentQuestion.answer.join(', ') : currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';

    saveProgress(); // Save the restored state
}

document.addEventListener('keydown', function(event) {
    if (document.querySelector('.start-screen').style.display !== 'none') {
        if (event.key === 'Enter') {
            if (!selectedJson) {
                return;
            }
            document.getElementById('startGame').click();
            return;
        }
    }
    if (customAlert.style.display === 'flex') {
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

document.getElementById('button-row').addEventListener('click', function(event) {
    if (event.target && event.target.matches('button.select-button')) {
        const selectedButton = event.target;
        // Do not deselect shuffle button if it's the one being clicked
        if (!selectedButton.id || selectedButton.id !== 'shuffleToggleBtn') {
            const allButtons = document.querySelectorAll('#button-row .select-button');
            allButtons.forEach(btn => btn.classList.remove('selected'));
            selectedButton.classList.add('selected');
        }
        // Only update selectedJson if it's a quiz selection button
        if (selectedButton.dataset.json) {
            selectedJson = selectedButton.dataset.json;
        }
    }
});

const shuffleToggle = document.getElementById('shuffleToggle');
if (shuffleToggle) {
    shuffleToggle.addEventListener('click', () => {
        shouldShuffleQuiz = !shouldShuffleQuiz;
        shuffleToggle.classList.toggle('active');
        if (shouldShuffleQuiz) {
            shuffleToggle.title = '順序：隨機';
        } else {
            shuffleToggle.title = '順序：固定';
        }
    });
    // Set initial state tooltip
    shuffleToggle.title = '順序：固定'; // Default state is ordered
}

function gatherEditedContent() {
    const currentDate = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true });
    const jsonFileName = selectedJson || 'default.json';
    const question = document.querySelector('#popupWindow .editable:nth-child(2)').innerText;
    const optionsText = document.querySelector('#popupWindow .editable:nth-child(3)').innerText;
    const answer = document.querySelector('#popupWindow .editable:nth-child(5)').innerText;
    const explanation = document.querySelector('#popupWindow .editable:nth-child(7)').innerText;
    let options = {};
    const optionRegex = /([A-E]):\s*([^A-E:]*)/g;
    let match;
    while ((match = optionRegex.exec(optionsText)) !== null) {
        const label = match[1];
        const text = match[2].trim();
        options[label] = text;
    }
    if (Object.keys(options).length === 0) {
        options = optionsText.split('\n').reduce((acc, option) => {
            const [key, value] = option.split(': ');
            if (key && value) acc[key.trim()] = value.trim();
            return acc;
        }, {});
    }
    if (Object.keys(options).length < 2) {
        showCustomAlert('請確保每個選項都以 A、B、C、D、E 開頭並分行。');
        return;
    }
    const formattedContent = `${currentDate}\n${jsonFileName}\n{\n"question": "${question}",\n"options": ${JSON.stringify(options, null, 2)},\n"answer": "${answer}",\n"explanation": "${explanation}"\n}`;
    sendToGoogleDocs(formattedContent);
}

function sendToGoogleDocs(content) {
    const url = 'https://script.google.com/macros/s/AKfycbxte_ckNlaaEKZJDTBO4I0rWiHvvvfoO1NpmLh8BttISEWuD6A7PmqM63AYDAzPwB-x/exec';
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ content: content })
    })
    .then(response => response.text())
    .then(data => {
        console.log(data);
    })
    .catch(error => {
        console.error('Error:', error);
        showCustomAlert('Failed to send content to Google Docs.');
    });
}

document.getElementById('sendButton').addEventListener('click', gatherEditedContent);

// Debug icon click handler
const debugIcon = document.getElementById('deBug');
const popupWindow = document.getElementById('popupWindow');
const closeButton = document.getElementById('closeButton');

debugIcon.addEventListener('click', () => {
    // Populate current question and details
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options || {}).map(
      ([key, value]) => `${key}: ${value}`
    ).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '';
    // Show debug modal
    popupWindow.style.display = 'flex';
});

closeButton.addEventListener('click', () => {
    popupWindow.style.display = 'none';
});

// Prevent clicks inside content closing the modal
popupWindow.querySelector('.content').addEventListener('click', (e) => {
    e.stopPropagation();
});
popupWindow.addEventListener('click', () => {
    popupWindow.style.display = 'none';
});

window.addEventListener("beforeunload", function (event) {
    event.preventDefault();
    event.returnValue = '';
});

// 從 Firebase 讀取可用的題庫清單並建立按鈕
async function fetchQuizList() {
    try {
        const listRef = ref(database, '/');  // 根目錄或指定清單路徑
        const snapshot = await get(listRef);
        const buttonContainer = document.getElementById('button-row');
        buttonContainer.innerHTML = '';
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.keys(data).forEach(key => {
                if (key === 'progress' || key === 'API_KEY') return;
                const btn = document.createElement('button');
                btn.classList.add('select-button');
                btn.dataset.json = key;  // 使用 key 作為路徑
                btn.innerText = key;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.select-button').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    selectedJson = key;
                });
                buttonContainer.appendChild(btn);
            });
        } else {
            console.warn('Firebase 上沒有題庫列表');
        }
    } catch (error) {
        console.error('從 Firebase 載入題庫清單失敗：', error);
        showCustomAlert('載入題庫清單失敗，請稍後再試');
    }
}

window.addEventListener('DOMContentLoaded', fetchQuizList);

// Quiz upload handling (modal-based)
const uploadModal = document.getElementById('uploadModal');
const uploadNameInput = document.getElementById('uploadNameInput');
const uploadConfirmBtn = document.getElementById('uploadConfirmBtn');
let pendingQuizData = null;
const addBtn = document.getElementById('addQuizBtn');
const uploadInput = document.getElementById('uploadJson');
const pasteJson = document.getElementById('pasteJson');
const fileDropZone = document.getElementById('fileDropZone');
const dropZoneLabel = document.getElementById('dropZoneLabel');
const uploadModeRadios = uploadModal.querySelectorAll('input[name="upload-mode"]');

// Add button always opens modal in paste mode
addBtn.addEventListener('click', () => {
  // Set mode to paste on open
  uploadModal.style.display = 'flex';
  uploadModeRadios.forEach(r => r.checked = r.value === 'paste');
  pasteJson.style.display = 'block';
  fileDropZone.style.display = 'none';
  pasteJson.value = '';
  uploadNameInput.value = '';
  pendingQuizData = null;
});

// Upload mode switching logic
uploadModeRadios.forEach(radio => {
  radio.addEventListener('change', e => {
    if (e.target.value === 'file') {
      pasteJson.style.display = 'none';
      fileDropZone.style.display = 'block';
    } else {
      pasteJson.style.display = 'block';
      fileDropZone.style.display = 'none';
    }
  });
});

// Click to open file selector
fileDropZone.addEventListener('click', () => uploadInput.click());
// Prevent default for drag events
['dragenter','dragover','dragleave','drop'].forEach(evt => {
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
  pasteJson.style.display = 'none';
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
  pasteJson.style.display = 'block';
  fileDropZone.style.display = 'none';
});



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
    currentQuestion.explanation = '<span class="typing-effect">Guru Grogu 正在運功...</span>';
    document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);

    let fetchedApiKey;
    try {
        const apiKeySnapshot = await get(ref(database, 'API_KEY'));
        if (!apiKeySnapshot.exists() || typeof apiKeySnapshot.val() !== 'string' || apiKeySnapshot.val().trim() === '') {
            showCustomAlert('錯誤：無法從資料庫獲取有效的 API 金鑰。請洽管理員設定。');
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
    
    const MODEL_NAME = 'gemini-2.5-flash-lite';
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${fetchedApiKey}`;

    const systemInstructionText = "你是Guru Grogu，由Jedieason訓練的助理。使用正體中文（臺灣）或英文回答。回答我的提問，我的提問內容會是基於我提問後面所附的題目，但那個題目並非你主要要回答的內容。回應請使用Markdown格式排版，所有Markdown語法都可以使用。請不要上網搜尋。Simplified Chinese and pinyin are STRICTLY PROHIBITED. Do not include any introductory phrases or opening remarks.";

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
        userQuestionInput.value = '';
        console.log('Gemini 回應更新成功啦！爽喔！🚀');

    } catch (error) {
        console.error('呼叫 Gemini API 的時候又他媽的炸裂了:', error);
        currentQuestion.explanation = `幹拎老師，呼叫 Gemini API 時噴了個大錯誤：${error.message} 💩。媽的，這預覽版模型是不是有問題啊！`;
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
    } finally {
        // inputSection.style.display = 'block'; // 看你要不要加回來
    }
});


userQuestionInput.addEventListener('keydown', function(event) {
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


// Login Modal Elements
const loginModal = document.getElementById('loginModal');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
// const loginCancelBtn = document.getElementById('loginCancelBtn');
const loginError = document.getElementById('loginError');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
let isRegisterMode = false;

// Open login modal
signInBtn.innerText = '登入';
signInBtn.addEventListener('click', () => {
  loginError.innerText = '';
  loginEmail.value = '';
  loginPassword.value = '';
  loginModal.style.display = 'flex';
});

// Login/Register handler
loginBtn.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const password = loginPassword.value.trim();
  loginError.innerText = '';
  try {
    let userCredential;
    if (isRegisterMode) {
      userCredential = await createUserWithEmailAndPassword(auth, email, password);
    } else {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
    }
    const user = userCredential.user;
    loginModal.style.display = 'none';
    signInBtn.innerText = `您好，${user.email}`;
    signInBtn.disabled = true;
  } catch (error) {
    // Remove any "Firebase:" prefix from the error message before displaying
    const displayMsg = error.message.replace(/^Firebase:\s*/, '');
    loginError.innerText = displayMsg;
    // Show "忘記密碼？" link to allow password reset
    const resetLink = document.createElement('a');
    resetLink.innerText = '忘記密碼？';
    resetLink.href = '#';
    resetLink.style.marginLeft = '8px';
    resetLink.style.color = '#000';
    resetLink.style.cursor = 'pointer';
    resetLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!loginEmail.value.trim()) {
        showCustomAlert('請先輸入您的 Email 以重設密碼。');
        return;
      }
      try {
        await sendPasswordResetEmail(auth, loginEmail.value.trim());
        showCustomAlert('重設密碼郵件已發送，請檢查您的信箱。');
      } catch (resetError) {
        showCustomAlert('無法發送重設郵件：' + resetError.message.replace(/^Firebase:\s*/, ''));
      }
    });
    // Remove existing reset link if present, then append
    const existingLink = loginError.querySelector('a');
    if (existingLink) existingLink.remove();
    loginError.appendChild(resetLink);
  }
});

[loginEmail, loginPassword].forEach(input => {
    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            const isComposing = event.isComposing || event.target.getAttribute('aria-composing') === 'true';
            if (isComposing) {
                return;
            }
            event.preventDefault();
            loginBtn.click();
        }
    });
});

const toggleAuthText = document.getElementById('toggleAuthText');
toggleAuthText.addEventListener('click', () => {
  isRegisterMode = !isRegisterMode;
  loginBtn.innerText = isRegisterMode ? '註冊' : '登入';
  toggleAuthText.innerText = isRegisterMode ? '已經有帳號？登入' : '還沒有帳號？註冊';
});


// Delegate click to close any modal when '×' is clicked
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-close')) {
    console.log('modal-close clicked on', e.target);
    const modal = e.target.closest('.modal');
    console.log('Found modal:', modal);
    if (modal) {
      modal.style.display = 'none';
      console.log('Modal display set to none');
    }
  }
});

function loadQuestionFromState() {
    if (!currentQuestion || !currentQuestion.question) {
        showEndScreen();
        return;
    }
    updateStarIcon();
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    renderMathInElement(document.getElementById('question'), {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });

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
            button.addEventListener('click', selectOption);
            optionsContainer.appendChild(button);
        });
    } else {
        document.getElementById('options').style.display = 'none';
        fillblankContainer.style.display = 'none';
    }
    
    // Update popup window content (Debug modal)
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = Array.isArray(currentQuestion.answer) ? currentQuestion.answer.join(', ') : currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';

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

async function updateStarIcon() {
    if (!starBtn) return;
    if (!auth.currentUser) {
        starBtn.src = 'Images/star-empty.svg';
        return;
    }
    try {
        const snap = await get(ref(database, `progress/${auth.currentUser.uid}/starred`));
        const starred = snap.val() || [];
        const isStarred = starred.some(q => q.question === currentQuestion.question);
        starBtn.src = isStarred ? 'Images/star-filled.svg' : 'Images/star-empty.svg';
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
    if (index >= 0) {
        starred.splice(index, 1);
        starBtn.src = 'Images/star-empty.svg';
    } else {
        const sourceName = (selectedJson || '').split('/').pop().replace('.json', '');
        starred.push({ ...currentQuestion, source: sourceName });
        starBtn.src = 'Images/star-filled.svg';
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
                explanationDiv.innerHTML = marked.parse(q.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！');
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
function applyTheme() {
    const themeToggleBtn = document.getElementById('themeToggleBtn');

    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        themeIcon.src = 'Images/moon.svg';
        themeToggleBtn.classList.add('dark-mode-active');
    } else {
        document.body.classList.remove('dark-mode');
        themeIcon.src = 'Images/sun.svg';
        themeToggleBtn.classList.remove('dark-mode-active');
    }
    // 儲存主題設定到 localStorage
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
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

