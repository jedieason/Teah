// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAjvO8nSRkKXUp7gopj-X7QsOGRBHTxj1s",
  authDomain: "jedieason-trivia.firebaseapp.com",
  projectId: "jedieason-trivia",
  storageBucket: "jedieason-trivia.firebasestorage.app",
  messagingSenderId: "379460583179",
  appId: "1:379460583179:web:c9d36892128bb0ac066c0e",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const provider = new GoogleAuthProvider();

// 選取所有登入按鈕、登出按鈕和使用者資訊元素
const signInButtons = document.querySelectorAll(".login-button");
const signOutButtons = document.querySelectorAll(".signOutButton");
const userInfos = document.querySelectorAll(".user-info");
const userButtons = document.querySelectorAll(".user-button");
const userButtonsHomepage = document.querySelectorAll(".user-button-homepage");

// 使用 redirect 登入方式
const userSignIn = async () => {
  console.log("[DEBUG] userSignIn 開始執行");
  try {
    console.log("[DEBUG] 呼叫 signInWithRedirect");
    await signInWithRedirect(auth, provider);
    console.log("[DEBUG] signInWithRedirect 成功呼叫，等待轉跳");
  } catch (error) {
    console.error(`[DEBUG] Error ${error.code}: ${error.message}`);
  }
};

const userSignOut = async () => {
  console.log("[DEBUG] userSignOut 開始執行");
  try {
    await signOut(auth);
    console.log("[DEBUG] signOut 成功");
    // 登出後顯示所有登入按鈕並隱藏使用者資訊
    signInButtons.forEach(button => {
      button.style.display = "block";
      console.log("[DEBUG] 顯示登入按鈕");
    });
    userInfos.forEach(info => {
      info.style.display = "none";
      console.log("[DEBUG] 隱藏使用者資訊");
      const userButton = info.querySelector(".user-button");
      const userButtonHomepage = info.querySelector(".user-button-homepage");
      if (userButton) {
        userButton.src = "";
        userButton.style.display = "none";
        console.log("[DEBUG] 清除首頁及其他使用者圖片");
      }
      if (userButtonHomepage) {
        userButtonHomepage.src = "";
        userButtonHomepage.style.display = "none";
      }
    });
  } catch (error) {
    console.error(`[DEBUG] Sign out error: ${error.message}`);
  }
};

// 處理從 redirect 回來的結果
getRedirectResult(auth)
  .then((result) => {
    console.log("[DEBUG] getRedirectResult 回傳結果", result);
    if (result && result.user) {
      console.log("[DEBUG] 登入成功，取得使用者資料：", result.user);
      // 登入成功後隱藏所有登入按鈕並顯示使用者資訊
      signInButtons.forEach(button => {
        button.style.display = "none";
        console.log("[DEBUG] 隱藏登入按鈕");
      });
      userInfos.forEach(info => {
        info.style.display = "block";
        console.log("[DEBUG] 顯示使用者資訊");
        const userButton = info.querySelector(".user-button");
        const userButtonHomepage = info.querySelector(".user-button-homepage");
        if (userButton) {
          userButton.src = result.user.photoURL;
          userButton.style.display = "block";
          console.log("[DEBUG] 設定 user-button 圖片");
        }
        if (userButtonHomepage) {
          userButtonHomepage.src = result.user.photoURL;
          userButtonHomepage.style.display = "block";
          console.log("[DEBUG] 設定 user-button-homepage 圖片");
        }
      });
    } else {
      console.log("[DEBUG] 沒有從 redirect 取得登入結果");
    }
  })
  .catch((error) => {
    console.error(`[DEBUG] Redirect error: ${error.message}`);
  });

// 監聽認證狀態變化（除 redirect 之外的登入狀態變化）
onAuthStateChanged(auth, (user) => {
  console.log("[DEBUG] onAuthStateChanged 觸發，user 狀態：", user);
  if (user) {
    signInButtons.forEach(button => {
      button.style.display = "none";
      console.log("[DEBUG] 使用者已登入，隱藏登入按鈕");
    });
    userInfos.forEach(info => {
      info.style.display = "block";
      console.log("[DEBUG] 使用者已登入，顯示使用者資訊");
      const userButton = info.querySelector(".user-button");
      const userButtonHomepage = info.querySelector(".user-button-homepage");
      if (userButton) {
        userButton.src = user.photoURL;
        userButton.style.display = "block";
        console.log("[DEBUG] 更新 user-button 圖片");
      }
      if (userButtonHomepage) {
        userButtonHomepage.src = user.photoURL;
        userButtonHomepage.style.display = "block";
        console.log("[DEBUG] 更新 user-button-homepage 圖片");
      }
    });
  } else {
    signInButtons.forEach(button => {
      button.style.display = "block";
      console.log("[DEBUG] 使用者未登入，顯示登入按鈕");
    });
    userInfos.forEach(info => {
      info.style.display = "none";
      console.log("[DEBUG] 使用者未登入，隱藏使用者資訊");
      const userButton = info.querySelector(".user-button");
      const userButtonHomepage = info.querySelector(".user-button-homepage");
      if (userButton) {
        userButton.src = "";
        userButton.style.display = "none";
        console.log("[DEBUG] 清除 user-button 圖片");
      }
      if (userButtonHomepage) {
        userButtonHomepage.src = "";
        userButtonHomepage.style.display = "none";
        console.log("[DEBUG] 清除 user-button-homepage 圖片");
      }
    });
  }
});

// 為所有登入按鈕添加事件監聽器
signInButtons.forEach(button => {
  button.addEventListener('click', () => {
    console.log("[DEBUG] 登入按鈕被點擊");
    userSignIn();
  });
});

// 為所有登出按鈕添加事件監聽器
signOutButtons.forEach(button => {
  button.addEventListener('click', () => {
    console.log("[DEBUG] 登出按鈕被點擊");
    userSignOut();
  });
});

// 初始載入時隱藏所有使用者資訊
document.addEventListener('DOMContentLoaded', () => {
  console.log("[DEBUG] DOMContentLoaded 事件觸發，隱藏使用者資訊");
  userInfos.forEach(info => info.style.display = "none");
});
