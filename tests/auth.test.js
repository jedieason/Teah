import test from 'node:test';
import assert from 'node:assert/strict';
import { isIosStandalone, isInAppBrowser, formatSignInErrorMessage } from '../src/services/auth-helper.js';

test('isIosStandalone correctly detects iPhone standalone mode', () => {
    const iphoneNav = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', standalone: true };
    const winStandaloneProp = { navigator: iphoneNav };
    assert.equal(isIosStandalone(iphoneNav, winStandaloneProp), true);

    const winMatchMedia = {
        navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)' },
        matchMedia: query => ({ matches: query === '(display-mode: standalone)' })
    };
    assert.equal(isIosStandalone(winMatchMedia.navigator, winMatchMedia), true);

    const safariBrowserWin = {
        navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', standalone: false },
        matchMedia: () => ({ matches: false })
    };
    assert.equal(isIosStandalone(safariBrowserWin.navigator, safariBrowserWin), false);

    const androidPwaWin = {
        navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)', standalone: true },
        matchMedia: query => ({ matches: query === '(display-mode: standalone)' })
    };
    assert.equal(isIosStandalone(androidPwaWin.navigator, androidPwaWin), false);

    const desktopMac = {
        navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 },
        matchMedia: () => ({ matches: false })
    };
    assert.equal(isIosStandalone(desktopMac.navigator, desktopMac), false);
});

test('isInAppBrowser detects embedded webviews and passes normal browsers', () => {
    assert.equal(isInAppBrowser({ userAgent: 'Mozilla/5.0 Line/12.1.0' }), true);
    assert.equal(isInAppBrowser({ userAgent: 'Mozilla/5.0 [FBAN/FBIOS;FBAV/300.0]' }), true);
    assert.equal(isInAppBrowser({ userAgent: 'Mozilla/5.0 Instagram 200.0' }), true);
    assert.equal(isInAppBrowser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Version/17.4 Mobile/15E148 Safari/604.1' }), false);
    assert.equal(isInAppBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }), false);
});

test('formatSignInErrorMessage formats error codes descriptively', () => {
    assert.match(formatSignInErrorMessage({ code: 'auth/popup-closed-by-user' }), /已關閉登入視窗/);
    assert.match(formatSignInErrorMessage({ code: 'auth/popup-blocked' }), /彈出視窗/);
    assert.match(formatSignInErrorMessage({ code: 'auth/unauthorized-domain' }), /授權網域/);
    assert.match(formatSignInErrorMessage({ code: 'auth/network-request-failed' }), /網路連線/);
    const customErr = formatSignInErrorMessage({ code: 'auth/internal-error', message: 'Unknown error occurred' });
    assert.match(customErr, /auth\/internal-error/);
    assert.match(customErr, /Unknown error occurred/);
});
