// Firebase SDK imports and initialization (v11.6.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-analytics.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";
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

// 新增：歷史紀錄陣列
let questionHistory = [];
let wrongQuestions = [];

// GitHub API相關資訊
const GITHUB_USER = 'jedieason'; // 替換為您的GitHub用戶名
const GITHUB_REPO = 'Teah'; // 替換為您的存儲庫名稱
const GITHUB_FOLDER_PATH = '113-2Midterm'; // JSON檔案所在的目錄

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
    document.querySelector('.quiz-title').innerText = `${fileName} 題矣`;

    loadNewQuestion();
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
    if (currentQuestion.question) {
        questionHistory.push({
            question: currentQuestion,
            correctCount: correct,
            wrongCount: wrong
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

    // 獲取隨機題目
    shuffle(questions);
    currentQuestion = questions.pop(); // 取出一題

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
    if (currentQuestion.isMultiSelect) {
        // For multi-answer fill-in-the-blank questions, use "句" instead of "多"
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

    if (!currentQuestion.isFillBlank) {
        // 檢查題型
        const optionKeys = Object.keys(currentQuestion.options);
        let optionLabels = [];
        let shouldShuffle = true;

        if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
            // 是是非題
            optionLabels = ['T', 'F'];
            shouldShuffle = false;
        } else {
            // 單選題（或多選題）都用這組標籤
            optionLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
            shouldShuffle = true;
        }

        // 獲取選項條目
        let optionEntries = Object.entries(currentQuestion.options);

        // 如果需要洗牌，則洗牌選項
        if (shouldShuffle) {
            shuffle(optionEntries);
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
}

// 更新詳解中的選項標籤
function updateExplanationOptions(explanation, labelMapping) {
    if (!explanation) {
        return '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';
    }
    return explanation.replace(/\((A|B|C|D|E|F|G|H|I|J|K|L)\)/g, function(match, label) {
        let newLabel = labelMapping[label] || label;
        return `(${newLabel})`;
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
        saveProgress();
    }
}

function updateCorrect() {
    correct += 1;
    document.getElementById('correct').innerText = correct;
    updateProgressBar();
}

function updateWrong() {
    wrongQuestions.push(currentQuestion);
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
    updateProgressBar();
}

function showEndScreen() {
    isTestCompleted = true;
    // Clear quiz UI
    const container = document.querySelector('.quiz-container');
    container.classList.add('end-screen');
    container.innerHTML = '';
    
    // Show completion message
    const message = document.createElement('div');
    message.innerText = `測驗完成！答對 ${correct} 題；答錯 ${wrong} 題。`;
    message.style.margin = '20px';
    container.appendChild(message);
    
    // "Redo Wrong" and "Reselect Quiz" buttons (in a flex row, no marginRight inline style)
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
        container.innerHTML = '';
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

    container.appendChild(buttonsDiv);
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
    if (currentQuestion.question) {
        questions.push(currentQuestion);
    }
    const previous = questionHistory.pop();
    currentQuestion = previous.question;
    correct = previous.correctCount;
    wrong = previous.wrongCount;
    document.getElementById('correct').innerText = correct;
    document.getElementById('wrong').innerText = wrong;
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    renderMathInElement(document.getElementById('question'), {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });
    const optionsContainer = document.getElementById('options');
    optionsContainer.innerHTML = '';
    for (let [key, value] of Object.entries(currentQuestion.options)) {
        const button = document.createElement('button');
        button.classList.add('option-button');
        button.dataset.option = key;
        button.innerHTML = marked.parse(`${key}: ${value}`);
        button.addEventListener('click', selectOption);
        optionsContainer.appendChild(button);
    }
    acceptingAnswers = true;
    if (currentQuestion.isMultiSelect) {
        selectedOptions = [];
    } else {
        selectedOption = null;
    }
    document.getElementById('explanation').style.display = 'none';
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.display = 'block';
    document.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected', 'correct', 'incorrect', 'missing');
    });
    currentQuestion.explanation = updateExplanationOptions(currentQuestion.explanation, {});
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options).map(([key, value]) => `${key}: ${value}`).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';
}

document.addEventListener('keydown', function(event) {
    if (document.querySelector('.start-screen').style.display !== 'none') {
        if (event.key === 'Enter') {
            if (!selectedJson) {
                showCustomAlert('你不選題目你是要玩什麼！');
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
        const allButtons = document.querySelectorAll('.select-button');
        allButtons.forEach(btn => btn.classList.remove('selected'));
        selectedButton.classList.add('selected');
        selectedJson = selectedButton.dataset.json;
    }
});


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
                if (key === 'progress') return;
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
    currentQuestion.explanation = '<span class="typing-effect">Guru Grogu 打字中...</span>';
    document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);

    // 組成要傳送的資料物件
    const data = {
        question,
        options,
        userQuestion,
        defaultAnswer
    };

    try {
        const response = await fetch("https://us-central1-geminiapiformedbot.cloudfunctions.net/triviaFunction", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        currentQuestion.explanation = result.response;
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        userQuestionInput.value = '';
        console.log('Explanation updated successfully!');
    } catch (error) {
        console.error(error);
        currentQuestion.explanation = '產生回應時發生錯誤，請稍後再試。';
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        console.log('Error generating explanation. Please try again later.');
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

function updateProgressBar() {
  if (initialQuestionCount > 0) {
    document.getElementById('correctBar').style.width = (correct / initialQuestionCount * 100) + '%';
    document.getElementById('wrongBar').style.width   = (wrong   / initialQuestionCount * 100) + '%';
  } else {
    document.getElementById('correctBar').style.width = '0%';
    document.getElementById('wrongBar').style.width   = '0%';
  }
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
        document.querySelector('.quiz-title').innerText = `${selectedJson.split('/').pop().replace('.json', '')} 題矣`;
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
    // Remove any “Firebase:” prefix from the error message before displaying
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
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    renderMathInElement(document.getElementById('question'), {
        delimiters: [
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true }
        ]
    });
    const optionKeys = Object.keys(currentQuestion.options);
    let optionLabels = [];
    let shouldShuffle = true;
    if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
        optionLabels = ['T', 'F'];
        shouldShuffle = false;
    } else {
        optionLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
        shouldShuffle = true;
    }
    let optionEntries = Object.entries(currentQuestion.options);
    if (shouldShuffle) {
        shuffle(optionEntries);
    }
    let labelMapping = {};
    for (let i = 0; i < optionEntries.length; i++) {
        const [originalLabel, _] = optionEntries[i];
        labelMapping[originalLabel] = optionLabels[i];
    }
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
    currentQuestion.options = newOptions;
    currentQuestion.answer = newAnswer;
    currentQuestion.explanation = updateExplanationOptions(currentQuestion.explanation, labelMapping);
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options).map(([key, value]) => `${key}: ${value}`).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Guru Grogu！';
}