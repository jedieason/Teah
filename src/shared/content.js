export function markdown(value) {
    return DOMPurify.sanitize(marked.parse(String(value ?? '')), { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'iframe', 'form'] });
}

export function validateQuiz(data) {
    if (!Array.isArray(data) || !data.length) throw new Error('題庫必須是非空的題目陣列。');
    data.forEach((q, index) => {
        if (!q || typeof q.question !== 'string' || !q.question.trim()) throw new Error(`第 ${index + 1} 題缺少題目。`);
        const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
        if (!answers.length || answers.some(a => typeof a !== 'string' || !a.trim())) throw new Error(`第 ${index + 1} 題的答案格式不正確。`);
        if (q.options && (Array.isArray(q.options) || typeof q.options !== 'object' || Object.keys(q.options).length < 2
            || Object.values(q.options).some(v => typeof v !== 'string') || answers.some(a => !(a in q.options)))) {
            throw new Error(`第 ${index + 1} 題的選項與答案不一致。`);
        }
    });
    return data;
}
