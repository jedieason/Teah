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
    const code = error.code || 'unknown';
    const message = error.message || 'unknown';

    if (code === 'auth/popup-closed-by-user') {
        return '已關閉登入視窗。若在 iPhone 主畫面 App 登入，請確認是否已完成授權。';
    }
    if (code === 'auth/popup-blocked') {
        return '登入視窗被瀏覽器阻擋，請確認允許彈出視窗。';
    }
    if (code === 'auth/unauthorized-domain') {
        return '此網域尚未加入 Firebase 授權網域，請至 Firebase Console 設定。';
    }
    if (code === 'auth/network-request-failed') {
        return '網路連線失敗，請檢查網路連線或稍後再試。';
    }
    return `Google 登入失敗\n代碼: ${code}\n訊息: ${message}`;
}
