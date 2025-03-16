// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence 
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

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

// 登入函式，先設定使用 local persistence
const userSignIn = async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    // 登入成功後隱藏所有登入按鈕並顯示使用者資訊
    signInButtons.forEach(button => button.style.display = "none");
    userInfos.forEach(info => {
      info.style.display = "block";
      const userButton = info.querySelector(".user-button");
      const userButtonHomepage = info.querySelector(".user-button-homepage");
      if (userButton) {
        userButton.src = user.photoURL;
        userButton.style.display = "block";
      }
      if (userButtonHomepage) {
        userButtonHomepage.src = user.photoURL;
        userButtonHomepage.style.display = "block";
      }
    });
    console.log(user);
  } catch (error) {
    console.error(`Error ${error.code}: ${error.message}`);
  }
};

// 登出函式
const userSignOut = async () => {
  try {
    await signOut(auth);
    // 登出後顯示所有登入按鈕並隱藏使用者資訊
    signInButtons.forEach(button => button.style.display = "block");
    userInfos.forEach(info => {
      info.style.display = "none";
      const userButtonHomepage = info.querySelector(".user-button-homepage");
      if (userButtonHomepage) {
        userButtonHomepage.src = "";
        userButtonHomepage.style.display = "none";
      }
    });
    console.log("User signed out");
  } catch (error) {
    console.error(`Sign out error: ${error.message}`);
  }
};

// 為所有登入按鈕添加事件監聽器
signInButtons.forEach(button => {
  button.addEventListener('click', userSignIn);
});

// 為所有登出按鈕添加事件監聽器
signOutButtons.forEach(button => {
  button.addEventListener('click', userSignOut);
});

// 等待 DOM 完全載入後執行初始化及認證狀態監聽
document.addEventListener('DOMContentLoaded', () => {
  // 初始載入時隱藏所有使用者資訊
  userInfos.forEach(info => info.style.display = "none");

  // 綁定認證狀態監聽器
  onAuthStateChanged(auth, (user) => {
    if (user) {
      signInButtons.forEach(button => button.style.display = "none");
      userInfos.forEach(info => {
        info.style.display = "block";
        const userButton = info.querySelector(".user-button");
        const userButtonHomepage = info.querySelector(".user-button-homepage");
        if (userButton) {
          userButton.src = user.photoURL;
          userButton.style.display = "block";
        }
        if (userButtonHomepage) {
          userButtonHomepage.src = user.photoURL;
          userButtonHomepage.style.display = "block";
        }
      });
    } else {
      signInButtons.forEach(button => button.style.display = "block");
      userInfos.forEach(info => {
        info.style.display = "none";
        const userButton = info.querySelector(".user-button");
        const userButtonHomepage = info.querySelector(".user-button-homepage");
        if (userButton) {
          userButton.src = "";
          userButton.style.display = "none";
        }
        if (userButtonHomepage) {
          userButtonHomepage.src = "";
          userButtonHomepage.style.display = "none";
        }
      });
    }
  });
});
