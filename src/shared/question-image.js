import { auth, database, get, ref } from '../services/firebase.js';
import { isQuestionImage } from './content.js';

const imageCache = new Map();
let cacheOwner;

function readImage(path) {
    const uid = auth.currentUser?.uid;
    if (!uid) return Promise.reject(new Error('Sign-in required'));
    if (uid !== cacheOwner) {
        cacheOwner = uid;
        imageCache.clear();
    }
    if (!imageCache.has(path)) {
        if (imageCache.size >= 12) imageCache.delete(imageCache.keys().next().value);
        const request = get(ref(database, path)).then(snapshot => {
            const { contentType, base64 } = snapshot.val() || {};
            if (uid !== auth.currentUser?.uid || !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)
                || typeof base64 !== 'string' || base64.length > 699052 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
                throw new Error('Image unavailable');
            }
            return `data:${contentType};base64,${base64}`;
        }).catch(error => {
            if (imageCache.get(path) === request) imageCache.delete(path);
            throw error;
        });
        imageCache.set(path, request);
    }
    return imageCache.get(path);
}

export function appendQuestionImage(host, image, { deferred = false } = {}) {
    if (!isQuestionImage(image)) return;
    const figure = document.createElement('div');
    figure.className = 'question-image';
    const status = document.createElement('span');
    status.className = 'question-image-status';
    status.setAttribute('role', 'status');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'question-image-action';
    action.textContent = '查看題圖';
    figure.append(status, action);
    host.append(figure);

    async function load() {
        const hadFocus = document.activeElement === action;
        action.disabled = true;
        status.textContent = '載入題圖中…';
        const uid = auth.currentUser?.uid;
        const request = readImage(image.path);
        try {
            const picture = document.createElement('img');
            picture.alt = image.alt;
            picture.src = await request;
            await picture.decode();
            if (!figure.isConnected || uid !== auth.currentUser?.uid) return;
            figure.replaceChildren(picture);
            if (hadFocus && document.activeElement === document.body) {
                picture.tabIndex = -1;
                picture.focus({ preventScroll: true });
            }
        } catch {
            if (imageCache.get(image.path) === request) imageCache.delete(image.path);
            status.textContent = '題圖無法載入。';
            action.textContent = '重試';
            action.hidden = false;
            action.disabled = false;
        }
    }
    action.onclick = load;
    if (!deferred) {
        action.hidden = true;
        void load();
    }
}
