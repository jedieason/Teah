import { GoogleAuth } from 'google-auth-library';
import { AgentError } from './content.mjs';

const scopes = ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'];

export function createDatabase(databaseURL, { getToken, fetcher = fetch } = {}) {
    const base = new URL(databaseURL);
    const loopback = ['127.0.0.1', 'localhost'].includes(base.hostname);
    if (base.username || base.password || base.pathname !== '/' || base.hash || (!loopback && (
        base.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.(?:firebasedatabase\.app|firebaseio\.com)$/i.test(base.hostname) || base.search))) {
        throw new Error('TEAH_DATABASE_URL 需要 Firebase Realtime Database URL。');
    }
    if (loopback && !getToken) throw new Error('Firebase Emulator 需要明確指定測試憑證。');
    if (!getToken) {
        const auth = new GoogleAuth({ scopes });
        getToken = () => auth.getAccessToken();
    }

    async function request(path, options) {
        const url = new URL(base);
        url.pathname = `/${path.split('/').map(encodeURIComponent).join('/')}.json`;
        let response;
        try {
            const token = await getToken();
            if (!token) throw new Error('Missing token');
            response = await fetcher(url, {
                ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
                headers: { Authorization: `Bearer ${token}`, ...options.headers }
            });
        } catch {
            throw new AgentError(502, 'firebase_unreachable', '無法取得 Firebase 憑證或連線。');
        }
        if (response.status === 412) {
            await response.body?.cancel();
            throw new AgentError(409, 'conflict', 'Firebase 資料已由其他操作更新。請讀回最新版再重試。');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new AgentError(502, 'firebase_error', `Firebase 回應 HTTP ${response.status}。`);
        }
        return response;
    }

    return {
        async read(path) {
            const response = await request(path, { headers: { 'X-Firebase-ETag': 'true' } });
            const version = response.headers.get('etag');
            if (!version) throw new AgentError(502, 'missing_version', 'Firebase 沒有回傳寫入版本。');
            return { value: await response.json(), version };
        },
        async put(path, value, version) {
            if (!version) throw new Error('Conditional write requires a version');
            const response = await request(path, { method: 'PUT', headers: { 'If-Match': version, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
            await response.body?.cancel();
        }
    };
}
