// Firebase SDK imports and initialization (v12.12.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";
import { getDatabase, ref, get, update, set, remove, runTransaction } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, deleteUser, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const currentHost = window.location.hostname;
const defaultAuthDomain = "stock-market-ntumed.firebaseapp.com";
const isFirebaseHost = currentHost.endsWith(".web.app") || currentHost.endsWith(".firebaseapp.com");
const authDomain = isFirebaseHost ? currentHost : defaultAuthDomain;

const firebaseConfig = {
    apiKey: "AIzaSyBDUkxPjus-JYd2WZqys_eP5sWxLkMs2CI",
    authDomain: authDomain,
    databaseURL: "https://stock-market-ntumed-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "stock-market-ntumed",
    storageBucket: "stock-market-ntumed.firebasestorage.app",
    messagingSenderId: "1032461117274",
    appId: "1:1032461117274:web:33b51256202657864ff563",
    measurementId: "G-5ZZWMMLEKK"
};

const app = initializeApp(firebaseConfig);
// Analytics is optional and must not block studying.
if (localStorage.getItem('teah-analytics-consent') === 'yes') { try { getAnalytics(app); } catch {} }
const database = getDatabase(app);
// Firebase Auth
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { database, auth, googleProvider, ref, get, update, set, remove, runTransaction, signInWithPopup, onAuthStateChanged, signOut, deleteUser, reauthenticateWithPopup };
