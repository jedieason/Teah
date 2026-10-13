export function isIosStandalone(nav = (typeof navigator !== 'undefined' ? navigator : null), win = (typeof window !== 'undefined' ? window : null)) {
    if (!win || !nav) return false;
    const ua = nav.userAgent || nav.vendor || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1);
    const isStandalone = win.navigator?.standalone === true ||
        (typeof win.matchMedia === 'function' && Boolean(win.matchMedia('(display-mode: standalone)')?.matches));
    return Boolean(isIOS && isStandalone);
}

export function isInAppBrowser(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
    if (!nav) return false;
    const ua = nav.userAgent || nav.vendor || '';
    return (ua.indexOf("FBAN") > -1) || (ua.indexOf("FBAV") > -1) || (ua.indexOf("Line") > -1) || (ua.indexOf("Instagram") > -1);
}

export function formatSignInErrorMessage(error) {
    if (!error) return 'Google 登入失敗，請稍後再試。';
    const code = error.code || error.error || 'unknown';
    const message = error.message || '';

    if (code === 'auth/popup-closed-by-user' || code === 'popup_closed_by_user') {
        return '已關閉登入視窗。';
    }
    if (code === 'auth/popup-blocked') {
        return '登入視窗被瀏覽器阻擋，請確認允許彈出視窗。';
    }
    if (code === 'auth/unauthorized-domain' || code === 'idpiframe_initialization_failed') {
        return '此網域尚未加入授權網域，請至 Firebase Console / Google Cloud 設定。';
    }
    if (code === 'auth/network-request-failed') {
        return '網路連線失敗，請檢查網路連線或稍後再試。';
    }
    if (code === 'auth/missing-initial-state' || message.includes('missing initial state')) {
        return '跨網域儲存隔離導致狀態遺失。請避免使用重定向登入，或改用 Google 彈出式視窗登入。';
    }
    return `Google 登入失敗\n代碼: ${code}\n訊息: ${message || 'unknown'}`;
}
