let questions = [];
let currentQuestion = {};
let acceptingAnswers = true;
let selectedOption = null;
let correct = 0;
let wrong = 0;
let selectedJson = null; // 初始為 null
let isTestCompleted = false; // Flag to track test completion
   
// 新增：歷史紀錄陣列
let questionHistory = [];

// GitHub API相關資訊
const GITHUB_USER = 'jedieason'; // 替換為您的GitHub用戶名
const GITHUB_REPO = 'Trivia.tw'; // 替換為您的存儲庫名稱
const GITHUB_FOLDER_PATH = '113 Finals'; // JSON檔案所在的目錄

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
    selectedOption = null;
    document.getElementById('explanation').style.display = 'none';
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.display = 'block';
    document.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected', 'correct', 'incorrect');
    });

    if (questions.length === 0) {
        // 沒有更多題目，結束測驗
        showEndScreen();
        return;
    }

    // 獲取隨機題目
    shuffle(questions);
    currentQuestion = questions.pop(); // 取出一題

    // 更新題目文本
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    

    // 檢查題型
    const optionKeys = Object.keys(currentQuestion.options);
    let optionLabels = [];
    let shouldShuffle = true;

    if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
        // 是是非題
        optionLabels = ['T', 'F'];
        shouldShuffle = false;
    } else {
        // 單選題
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
    let newAnswer = '';
    for (let i = 0; i < optionEntries.length; i++) {
        const [label, text] = optionEntries[i];
        const newLabel = optionLabels[i];
        newOptions[newLabel] = text;

        const button = document.createElement('button');
        button.classList.add('option-button');
        button.dataset.option = newLabel;
        button.innerText = `${newLabel}: ${text}`;
        button.addEventListener('click', selectOption);
        optionsContainer.appendChild(button);

        if (label === currentQuestion.answer) {
            newAnswer = newLabel;
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
    // 找到所有括號內的選項標籤
    if (!explanation) {
        return '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
    }
    return explanation.replace(/\((A|B|C|D|E)\)/g, function(match, label) {
        // 替換為洗牌後的選項標籤
        let newLabel = labelMapping[label] || label;
        return `(${newLabel})`;
    });
}

// 選擇選項
function selectOption(event) {
    if (!acceptingAnswers) return;
    document.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');
    selectedOption = event.currentTarget.dataset.option;
}

// 取得模態窗口和確認按鈕元素
const customAlert = document.getElementById('customAlert');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalMessage = document.getElementById('modal-message'); // 新增

// 設置模態窗口的訊息
function setModalMessage(message) {
    modalMessage.innerText = message;
}

// 顯示自訂模態窗口
function showCustomAlert(message) {
    setModalMessage(message);
    customAlert.style.display = 'flex';
}

// 隱藏自訂模態窗口
function hideCustomAlert() {
    customAlert.style.display = 'none';
}

// 修改確認按鈕的事件監聽器
modalConfirmBtn.addEventListener('click', () => {
    hideCustomAlert();
    if (isTestCompleted) {
        location.reload(); // Reload the page if the test is completed
    }
});

// 修改 confirmAnswer 函數以使用自訂模態窗口
function confirmAnswer() {
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
        // 高亮正確答案
        const correctBtn = document.querySelector(`.option-button[data-option='${currentQuestion.answer}']`);
        correctBtn.classList.add('correct');
        updateWrong();
    }

    // 顯示解釋
    document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
    
    document.getElementById('explanation').style.display = 'block';
    document.getElementById('confirm-btn').style.display = 'none';
    saveProgress();
}

// 更新對數
function updateCorrect() {
    correct += 1;
    document.getElementById('correct').innerText = correct;
}

// 更新答錯數
function updateWrong() {
    wrong += 1;
    document.getElementById('wrong').innerText = wrong;
}

// 顯示結束畫面
function showEndScreen() {
    isTestCompleted = true; // Indicate that the test has been completed
    showCustomAlert(`測驗完成！\n答對 ${correct} 題；答錯 ${wrong} 題。`);
}

function copyQuestion() {
    // Ensure there is a current question loaded
    if (!currentQuestion.question) {
        alert('No question to copy.');
        return;
    }

    // Build the formatted text
    let textToCopy = '';
    // Include the question
    textToCopy += 'Question:\n' + currentQuestion.question + '\n';
    // Include options, marking the correct one
    // textToCopy += 'Options:\n';
    for (let [optionKey, optionText] of Object.entries(currentQuestion.options)) {
        if (optionKey === currentQuestion.answer) {
            // Mark the correct option
            textToCopy += optionKey + ': ' + optionText + ' (Correct)\n';
        } else {
            textToCopy += optionKey + ': ' + optionText + '\n';
        }
    }
    // Include the explanation
    textToCopy += '\nExplanation:\n' + (currentQuestion.explanation || 'No explanation provided.');

    navigator.clipboard.writeText(textToCopy).then(function() {
        // Optional: Provide feedback to the user
        showCustomAlert('題目已複製！');
    }, function(err) {
        // Fallback in case of an error
        alert('Could not copy text: ' + err);
    });
}

// 事件監聽器
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

// 新增：Reverse button 的事件監聽器
document.getElementById('reverseButton').addEventListener('click', reverseQuestion);

// Reverse question function
function reverseQuestion() {
    if (questionHistory.length === 0) {
        showCustomAlert('沒有上一題了！');
        return;
    }

    // 將當前問題推回 questions 堆疊
    if (currentQuestion.question) {
        questions.push(currentQuestion);
    }

    // 從歷史紀錄中彈出上一題
    const previous = questionHistory.pop();
    currentQuestion = previous.question;
    correct = previous.correctCount;
    wrong = previous.wrongCount;

    // 更新正確和錯誤數據
    document.getElementById('correct').innerText = correct;
    document.getElementById('wrong').innerText = wrong;

    // 更新題目和選項
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    

    const optionsContainer = document.getElementById('options');
    optionsContainer.innerHTML = '';
    for (let [key, value] of Object.entries(currentQuestion.options)) {
        const button = document.createElement('button');
        button.classList.add('option-button');
        button.dataset.option = key;
        button.innerText = `${key}: ${value}`;
        button.addEventListener('click', selectOption);
        optionsContainer.appendChild(button);
    }

    // 重置 UI 狀態
    acceptingAnswers = true;
    selectedOption = null;
    document.getElementById('explanation').style.display = 'none';
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.display = 'block';
    document.querySelectorAll('.option-button').forEach(btn => {
        btn.classList.remove('selected', 'correct', 'incorrect');
    });

    // 更新詳解中的選項標籤
    currentQuestion.explanation = updateExplanationOptions(currentQuestion.explanation, {});

    // 更新模態窗口的內容
    document.querySelector('#popupWindow .editable:nth-child(2)').innerText = currentQuestion.question;
    const optionsText = Object.entries(currentQuestion.options).map(([key, value]) => `${key}: ${value}`).join('\n');
    document.querySelector('#popupWindow .editable:nth-child(3)').innerText = optionsText;
    document.querySelector('#popupWindow .editable:nth-child(5)').innerText = currentQuestion.answer;
    document.querySelector('#popupWindow .editable:nth-child(7)').innerText = currentQuestion.explanation || '這題目前還沒有詳解，有任何疑問歡迎詢問 Gemini 2.0！';
}

// 按鍵按下事件（可選）
document.addEventListener('keydown', function(event) {
    // 檢查是否在Start畫面 (start-screen尚未隱藏)
    if (document.querySelector('.start-screen').style.display !== 'none') {
        if (event.key === 'Enter') {
            if (!selectedJson) {
                showCustomAlert('Please select a question bank first!');
                return;
            }
            document.getElementById('startGame').click();
            return;
        }
    }

    // 檢查Custom Alert是否顯示中
    if (customAlert.style.display === 'flex') {
        if (event.key === 'Enter') {
            modalConfirmBtn.click();
            return;
        }
    }

    // Check if the focused element is the userQuestionInput
    if (event.target === userQuestionInput) {
        // Let the userQuestionInput's own listener handle the Enter key
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



// 新增選擇按鈕的功能
document.getElementById('button-row').addEventListener('click', function(event) {
    if (event.target && event.target.matches('button.select-button')) {
        const selectedButton = event.target;
        // 移除所有按鈕的選中狀態
        const allButtons = document.querySelectorAll('.select-button');
        allButtons.forEach(btn => btn.classList.remove('selected'));
        // 添加選中狀態到當前按鈕
        selectedButton.classList.add('selected');
        // 設定要載入的 JSON 檔案
        selectedJson = selectedButton.dataset.json;
    }
});

// 切換模式
const modeToggleHeader = document.getElementById('modeToggle-header');

modeToggleHeader.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');

    const img = modeToggleHeader.querySelector('img');
    if (document.body.classList.contains('dark-mode')) {
        img.src = 'Images/sun.svg'; // Change to sun icon
    } else {
        img.src = 'Images/moon.svg'; // Change to moon icon
    }
});

// // 為兩個 profile pic 添加點擊事件
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

        // Set a timeout to close the expansion after 10 seconds
        clearTimeout(expandTimeout);
        expandTimeout = setTimeout(() => {
            closeExpand(frame, logoutButton);
        }, 10000); // 10 seconds
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

    // 新增：解析選項
    let options = {};
    const optionRegex = /([A-E]):\s*([^A-E:]*)/g;
    let match;
    while ((match = optionRegex.exec(optionsText)) !== null) {
        const label = match[1];
        const text = match[2].trim();
        options[label] = text;
    }

    // 如果沒有匹配到任何選項，嘗試按換行符分割
    if (Object.keys(options).length === 0) {
        options = optionsText.split('\n').reduce((acc, option) => {
            const [key, value] = option.split(': ');
            if (key && value) acc[key.trim()] = value.trim();
            return acc;
        }, {});
    }

    // 確保有至少兩個選項
    if (Object.keys(options).length < 2) {
        showCustomAlert('請確保每個選項都以 A、B、C、D、E 開頭並分行。');
        return;
    }

    const formattedContent = `${currentDate}\n${jsonFileName}\n{\n"question": "${question}",\n"options": ${JSON.stringify(options, null, 2)},\n"answer": "${answer}",\n"explanation": "${explanation}"\n}`;

    sendToGoogleDocs(formattedContent);
}


function sendToGoogleDocs(content) {
    const url = 'https://script.google.com/macros/s/AKfycbxte_ckNlaaEKZJDTBO4I0rWiHvvvfoO1NpmLh8BttISEWuD6A7PmqM63AYDAzPwB-x/exec'; // Replace with your web app URL

    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ content: content })
    })
    .then(response => response.text())
    .then(data => {
        console.log(data); // Log the response from the server
    })
    .catch(error => {
        console.error('Error:', error);
        showCustomAlert('Failed to send content to Google Docs.');
    });
}

// Add an event listener to the send button
document.getElementById('sendButton').addEventListener('click', gatherEditedContent);

window.addEventListener("beforeunload", function (event) {
    event.preventDefault();
    event.returnValue = '';
});

// 新增函數：從GitHub獲取JSON檔案列表並生成按鈕
async function fetchJsonFiles() {
    const apiUrl = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER_PATH}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        const data = await response.json();
        const buttonContainer = document.getElementById('button-row');

        // 遍歷檔案，尋找.json結尾的檔案
        data.forEach(item => {
            if (item.type === 'file' && item.name.endsWith('.json')) {
                const relativePath = item.path.replace(/\\/g, '/'); // 確保路徑使用正斜線
                const button = document.createElement('button');
                button.classList.add('select-button');
                button.dataset.json = relativePath;
                // 按鈕顯示名稱可以根據需要調整，例如去除副檔名
                button.innerText = item.name.replace('.json', '');
                button.addEventListener('click', () => {
                    // 移除其他按鈕的選中狀態
                    const allButtons = document.querySelectorAll('.select-button');
                    allButtons.forEach(btn => btn.classList.remove('selected'));
                    // 添加選中狀態到當前按鈕
                    button.classList.add('selected');
                    // 設定要載入的 JSON 檔案
                    selectedJson = button.dataset.json;
                });
                buttonContainer.appendChild(button);
            }
        });
    } catch (error) {
        console.error('Error fetching JSON files from GitHub:', error);
        showCustomAlert('Failed to load question banks. Please try again later.');
    }
}

// 在頁面加載時呼叫fetchJsonFiles
window.addEventListener('DOMContentLoaded', fetchJsonFiles);

// script.js
// Get elements
const weeGPTButton = document.getElementById('WeeGPT');
const inputSection = document.getElementById('WeeGPTInputSection');
const sendQuestionBtn = document.getElementById('sendQuestionBtn');
const explanationDiv = document.getElementById('explanation');
const explanationText = document.getElementById('explanation-text');
const confirmBtn = document.getElementById('confirm-btn');

// Event listener for WeeGPT button
weeGPTButton.addEventListener('click', () => {
    if (!currentQuestion.question || !currentQuestion.options) {
        showCustomAlert('There is currently no question available for analysis.');
        return;
    }
    // Toggle visibility of input section
    inputSection.style.display = inputSection.style.display === 'flex' ? 'none' : 'flex';
});

// Event listener for Send button
sendQuestionBtn.addEventListener('click', async () => {
    const userQuestion = userQuestionInput.value.trim();
    if (!userQuestion) {
        alert('Please enter your question.');
        return;
    }

    // Hide input section
    inputSection.style.display = 'none';

    const question = currentQuestion.question;
    const options = currentQuestion.options;

    // Show loading state with spinner
    currentQuestion.explanation = '生成回答中⋯⋯';
    document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
    
    document.getElementById('explanation').style.display = 'block';
    document.getElementById('confirm-btn').style.display = 'none';
    console.log('Generating explanation, please wait...');

    try {
        // Call the generateExplanation function with user input
        const explanation = await window.generateExplanation(question, options, userQuestion);

        // Define signature
        // const signature = '\n\n*Generated by WeeGPT*'; // Using Markdown syntax

        // // Combine explanation with signature
        // const fullExplanation = explanation + signature;

        // Update currentQuestion's explanation
        currentQuestion.explanation = explanation;

        // Update the explanation section as specified
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        
        document.getElementById('explanation').style.display = 'block';
        document.getElementById('confirm-btn').style.display = 'none';
        userQuestionInput.value = '';
        // Log success
        console.log('Explanation updated successfully!');
    } catch (error) {
        console.error(error);
        // Show error message to user
        currentQuestion.explanation = 'An error occurred while generating the explanation. Please try again later.';
        document.getElementById('explanation-text').innerHTML = marked.parse(currentQuestion.explanation);
        
        document.getElementById('explanation').style.display = 'block';
        document.getElementById('confirm-btn').style.display = 'none';
        console.log('Error generating explanation. Please try again later.');
    }
});

// Add this event listener after initializing userQuestionInput
// Add this event listener after initializing userQuestionInput
userQuestionInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
        const isComposing = event.isComposing || event.target.getAttribute('aria-composing') === 'true';

        if (isComposing) {
            // 若正在選字，則不阻止預設行為
            return;
        }

        // 阻止預設行為並模擬送出按鈕點擊
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

        // 更新 UI
        document.querySelector('.start-screen').style.display = 'none';
        document.querySelector('.quiz-container').style.display = 'flex';
        document.querySelector('.quiz-title').innerText = `${selectedJson.split('/').pop().replace('.json', '')} 題矣`;
        document.getElementById('correct').innerText = correct;
        document.getElementById('wrong').innerText = wrong;

        // 加載當前題目
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

    // 更新題目文本
    document.getElementById('question').innerHTML = marked.parse(currentQuestion.question);
    

    // 檢查題型
    const optionKeys = Object.keys(currentQuestion.options);
    let optionLabels = [];
    let shouldShuffle = true;

    if (optionKeys.length === 2 && optionKeys.includes('T') && optionKeys.includes('F')) {
        // 是非題
        optionLabels = ['T', 'F'];
        shouldShuffle = false;
    } else {
        // 單選題
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
    let newAnswer = '';
    for (let i = 0; i < optionEntries.length; i++) {
        const [label, text] = optionEntries[i];
        const newLabel = optionLabels[i];
        newOptions[newLabel] = text;

        const button = document.createElement('button');
        button.classList.add('option-button');
        button.dataset.option = newLabel;
        button.innerText = `${newLabel}: ${text}`;
        button.addEventListener('click', selectOption);
        optionsContainer.appendChild(button);

        if (label === currentQuestion.answer) {
            newAnswer = newLabel;
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
}
