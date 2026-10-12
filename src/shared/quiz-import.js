import { validateQuiz } from './content.js';

// A batch carries its own titles; legacy question arrays still use the form/file name.
export function parseQuizImport(text, fallbackTitle = '') {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('JSON 格式錯誤，請貼上完整的 JSON 內容。'); }
    const isBatch = !Array.isArray(value) && value !== null && typeof value === 'object' && Object.hasOwn(value, 'banks');
    if (isBatch && (!Array.isArray(value.banks) || !value.banks.length)) throw new Error('banks 必須是非空的題庫陣列。');
    if (!isBatch) return { isBatch, banks: [{ title: fallbackTitle, questions: validateQuiz(value) }] };
    const banks = value.banks.map((bank, index) => {
        if (!bank || typeof bank.title !== 'string') throw new Error(`第 ${index + 1} 份題庫缺少 title 標題。`);
        try { validateQuiz(bank.questions); } catch (error) {
            throw new Error(`第 ${index + 1} 份題庫「${bank.title}」：${error.message}`);
        }
        return { title: bank.title.trim(), questions: bank.questions };
    });
    return { isBatch, banks };
}

export function buildImportChanges(banks, validName) {
    const titles = new Set();
    const entries = banks.map((bank, index) => {
        const title = bank.title.trim();
        if (!title) throw new Error(`請輸入第 ${index + 1} 份題庫的標題。`);
        if (!validName(title) || /[\x00-\x1f\x7f]/.test(title)) throw new Error(`第 ${index + 1} 份題庫標題不可包含 . # $ [ ] /、控制字元或使用系統名稱。`);
        if (titles.has(title)) throw new Error(`題庫標題「${title}」重複，請修改後再建立。`);
        titles.add(title);
        validateQuiz(bank.questions);
        return [title, bank.questions];
    });
    if (!entries.length) throw new Error('請提供至少一份題庫。');
    return Object.fromEntries(entries);
}
