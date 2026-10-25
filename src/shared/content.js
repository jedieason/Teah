export function markdown(value) {
    return DOMPurify.sanitize(marked.parse(String(value ?? '')), { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'iframe', 'form'] });
}

export function validateQuiz(data) {
    const fail = (message, path) => { throw Object.assign(new Error(message), { path }); };
    if (!Array.isArray(data) || !data.length) fail('題庫必須是非空的題目陣列。', []);
    const ids = new Set();
    data.forEach((q, index) => {
        if (!q || typeof q.question !== 'string' || !q.question.trim()) fail(`第 ${index + 1} 題缺少題目。`, [index, 'question']);
        if (q.questionId && (!/^[A-Za-z0-9_-]{1,120}$/.test(q.questionId) || ids.has(q.questionId))) fail(`第 ${index + 1} 題的永久題號無效或重複。`, [index, 'questionId']);
        if (q.questionId) ids.add(q.questionId);
        if (q.revision != null && (!Number.isInteger(q.revision) || q.revision < 1)) fail(`第 ${index + 1} 題的版本必須是正整數。`, [index, 'revision']);
        const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
        if (!answers.length || answers.some(a => typeof a !== 'string' || !a.trim())) fail(`第 ${index + 1} 題的答案格式不正確。`, [index, 'answer']);
        if (q.options && (Array.isArray(q.options) || typeof q.options !== 'object' || Object.keys(q.options).length < 2
            || Object.values(q.options).some(v => typeof v !== 'string') || answers.some(a => !(a in q.options)))) {
            fail(`第 ${index + 1} 題的選項與答案不一致。`, [index, 'options']);
        }
    });
    return data;
}
