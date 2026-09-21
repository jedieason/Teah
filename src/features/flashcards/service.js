import { database, auth, ref, get } from '../../services/firebase.js';
import { cardRequest, parseCards } from './model.js';
export function sourceQuestions(items) {
    return items.map((m, i) => ({ id: `s${i + 1}`, questionId: m.questionId || '', revision: m.revision || 1,
        question: m.question, options: m.options || null, answer: m.answer, explanation: m.explanation || '',
        lastSelection: m.lastSelection || null, source: m.origin || m.title || m.quizKey || '' }));
}
export async function generateCards(sources, signal) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('請先登入。');
    const key = await Promise.race([get(ref(database, 'API_KEY')).then(s => s.val()), new Promise((_, reject) => {
        if (signal.aborted) reject(new Error('已取消製作。'));
        else signal.addEventListener('abort', () => reject(new Error('製作已取消或逾時，請重試。')), { once: true });
    })]);
    if (auth.currentUser?.uid !== uid) throw new Error('帳戶已切換，請重新製作。');
    if (typeof key !== 'string' || !key.trim()) throw new Error('AI 服務尚未設定。');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardRequest(sources)), signal
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'AI 使用量暫時達上限，請稍後重試。' : 'AI 暫時無法製作字卡，請重試。');
    const result = await response.json(), candidate = result.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('字卡未完整生成，請重試。');
    if (auth.currentUser?.uid !== uid) throw new Error('帳戶已切換，請重新製作。');
    return parseCards(candidate.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join(''), sources);
}
