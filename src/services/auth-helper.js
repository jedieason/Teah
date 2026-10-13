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

export function parseAuthHash(hash) {
    if (!hash || typeof hash !== 'string') return {};
    const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(cleanHash);
    return {
        idToken: params.get('id_token') || null,
        accessToken: params.get('access_token') || null,
        error: params.get('error') || null,
        errorDescription: params.get('error_description') || null
    };
}

export function buildGoogleAuthUrl({ clientId, redirectUri, nonce, prompt = 'select_account' }) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid email profile',
        nonce: nonce,
        prompt: prompt
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function formatSignInErrorMessage(error) {
    if (!error) return 'Google 登入失敗，請稍後再試。';
    const code = error.code || error.error || error.type || 'unknown';
    const message = error.message || error.error_description || '';

    if (code === 'auth/popup-closed-by-user' || code === 'popup_closed_by_user' || code === 'popup_closed') {
        return '已關閉登入視窗。';
    }
    if (code === 'auth/popup-blocked' || code === 'popup_failed_to_open') {
        return '登入視窗被瀏覽器阻擋，請確認允許彈出視窗。';
    }
    if (code === 'auth/unauthorized-domain' || code === 'idpiframe_initialization_failed' || code === 'origin_mismatch') {
        return '此網域尚未加入授權網域，請至 Firebase Console / Google Cloud 設定。';
    }
    if (code === 'redirect_uri_mismatch') {
        return '重新導向 URI 不符合，請至 Google Cloud Console 憑證設定「已授權的重新導向 URI」。';
    }
    if (code === 'auth/network-request-failed') {
        return '網路連線失敗，請檢查網路連線或稍後再試。';
    }
    if (code === 'auth/missing-initial-state' || message.includes('missing initial state')) {
        return '跨網域儲存隔離導致狀態遺失。請避免使用重定向登入，或改用 Google 彈出式視窗登入。';
    }
    return `Google 登入失敗\n代碼: ${code}\n訊息: ${message || 'unknown'}`;
}
