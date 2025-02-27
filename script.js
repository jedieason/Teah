let questions = [];
let currentQuestion = {};
let acceptingAnswers = true;
let selectedOption = null; // 單選題使用
let selectedOptions = [];  // 多選題使用
let correct = 0;
let wrong = 0;
let selectedJson = null; // 初始為 null
let isTestCompleted = false; // Flag to track test completion

// 新增：歷史紀錄陣列
let questionHistory = [];

// GitHub API相關資訊
const GITHUB_USER = 'jedieason'; // 替換為您的GitHub用戶名
const GITHUB_REPO = 'Trivia.tw'; // 替換為您的存儲庫名稱
const GITHUB_FOLDER_PATH = '113-2'; // JSON檔案所在的目錄

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
    document.querySelector('.start-screen').style.display = 'none';
    document.querySelector('.quiz-container').style.display = 'flex';
    
    // Update the quiz title with the current file name
    const fileName = selectedJson.split('/').pop().replace('.json', '');
    document.querySelector('.quiz-title').innerText = `${fileName} 題矣`;

    loadNewQuestion();
}

// 加載題目
async function loadQuestions() {
    try {
        const response = await fetch(selectedJson);
        questions = await response.json();
    } catch (error) {
        console.error('Failed to load the question.', error);
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

    // 判斷是否為多選題（答案為陣列且長度超過1）
    if (Array.isArray(currentQuestion.answer) && currentQuestion.answer.length > 1) {
        currentQuestion.isMultiSelect = true;
    } else {
        currentQuestion.isMultiSelect = false;
    }

    // 更新題目文本，若為多選題則加上標籤
    const questionDiv = document.getElementById('question');
    if (currentQuestion.isMultiSelect) {
        questionDiv.innerHTML = '<div class="multi-label">多</div>' + marked.parse(currentQuestion.question);
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
        optionLabels = ['A', 'B', 'C', 'D', 'E'];
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
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
    saveProgress();
}

// 更新詳解中的選項標籤
function updateExplanationOptions(explanation, labelMapping) {
    if (!explanation) {
        return '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
    }
    return explanation.replace(/\((A|B|C|D|E)\)/g, function(match, label) {
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

function updateCorrect() {
    correct += 1;
    document.getElementById('correct').innerText = correct;
}

function updateWrong() {
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
}

function showEndScreen() {
    isTestCompleted = true;
    showCustomAlert(`測驗完成！\n答對 ${correct} 題；答錯 ${wrong} 題。`);
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
document.getElementById('restore').addEventListener('click', restoreProgress);

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
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
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

const modeToggleHeader = document.getElementById('modeToggle-header');
modeToggleHeader.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const img = modeToggleHeader.querySelector('img');
    if (document.body.classList.contains('dark-mode')) {
        img.src = 'Images/sun.svg';
    } else {
        img.src = 'Images/moon.svg';
    }
});

document.getElementById('userProfileHomeBtn').addEventListener('click', toggleExpand);
document.getElementById('userProfileBtn').addEventListener('click', toggleExpand);

function toggleExpand(event) {
    const frame = event.currentTarget.nextElementSibling;
    const logoutButton = frame.querySelector('.logout-button');
    if (!frame.classList.contains('expanded') && !frame.classList.contains('till-button-expanded')) {
        frame.classList.add('open-expansion');
        setTimeout(() => {
            frame.classList.remove('open-expansion');
            frame.classList.add('till-button-expanded');
            logoutButton.classList.add('show-logout');
        }, 300);
        clearTimeout(expandTimeout);
        expandTimeout = setTimeout(() => {
            closeExpand(frame, logoutButton);
        }, 10000);
    } else {
        closeExpand(frame, logoutButton);
    }
}

function closeExpand(frame, logoutButton) {
    if (frame.classList.contains('till-button-expanded')) {
        frame.classList.remove('till-button-expanded');
        frame.classList.add('expanded');
        logoutButton.classList.remove('show-logout');
        setTimeout(() => {
            frame.classList.remove('expanded');
        }, 300);
    } else {
        frame.classList.remove('expanded');
        logoutButton.classList.remove('show-logout');
    }
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

window.addEventListener("beforeunload", function (event) {
    event.preventDefault();
    event.returnValue = '';
});

async function fetchJsonFiles() {
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER_PATH}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        const buttonContainer = document.getElementById('button-row');
        data.forEach(item => {
            if (item.type === 'file' && item.name.endsWith('.json')) {
                const relativePath = item.path.replace(/\\/g, '/');
                const button = document.createElement('button');
                button.classList.add('select-button');
                button.dataset.json = relativePath;
                button.innerText = item.name.replace('.json', '');
                button.addEventListener('click', () => {
                    const allButtons = document.querySelectorAll('.select-button');
                    allButtons.forEach(btn => btn.classList.remove('selected'));
                    button.classList.add('selected');
                    selectedJson = button.dataset.json;
                });
                buttonContainer.appendChild(button);
            }
        });
    } catch (error) {
        console.error('Error fetching JSON files from GitHub:', error);
        showCustomAlert('載不出來欸，咋辦？');
    }
}

window.addEventListener('DOMContentLoaded', fetchJsonFiles);

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
});

sendQuestionBtn.addEventListener('click', async () => {
    const userQuestion = userQuestionInput.value.trim();
    if (!userQuestion) {
        alert('Please enter your question.');
        return;
    }
    inputSection.style.display = 'none';
    const defaultAnswer = currentQuestion.answer;
    const question = currentQuestion.question;
    const options = currentQuestion.options;
    currentQuestion.explanation = '生成回答中⋯⋯';
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
    console.log('Generating explanation, please wait...');
    try {
        const explanation = await window.generateExplanation(question, options, userQuestion, defaultAnswer);
        currentQuestion.explanation = explanation;
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
        userQuestionInput.value = '';
        console.log('Explanation updated successfully!');
    } catch (error) {
        console.error(error);
        currentQuestion.explanation = 'An error occurred while generating the explanation. Please try again later.';
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
    const progress = {
        questions: questions,
        currentQuestion: currentQuestion,
        correct: correct,
        wrong: wrong,
        questionHistory: questionHistory,
        selectedJson: selectedJson
    };
    localStorage.setItem('quizProgress', JSON.stringify(progress));
}

function restoreProgress() {
    const savedProgress = localStorage.getItem('quizProgress');
    if (!savedProgress) {
        showCustomAlert('沒有找到已保存的進度！');
        return;
    }
    try {
        const progress = JSON.parse(savedProgress);
        questions = progress.questions;
        currentQuestion = progress.currentQuestion;
        correct = progress.correct;
        wrong = progress.wrong;
        questionHistory = progress.questionHistory;
        selectedJson = progress.selectedJson;
        document.querySelector('.start-screen').style.display = 'none';
        document.querySelector('.quiz-container').style.display = 'flex';
        document.querySelector('.quiz-title').innerText = `${selectedJson.split('/').pop().replace('.json', '')} 題矣`;
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;
        loadQuestionFromState();
        showCustomAlert('進度已成功恢復！');
    } catch (error) {
        console.error('恢復進度時出錯：', error);
        showCustomAlert('恢復進度時出錯，請重試。');
    }
}

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
        optionLabels = ['A', 'B', 'C', 'D', 'E'];
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
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
}
