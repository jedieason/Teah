export const reservedBankKeys = new Set([
    'progress', 'mistakes', 'mistake', 'API_KEY', 'quizCatalog', 'quizAliases', 'config', 'learning',
    'contentDrafts', 'auditLog', 'feedback', 'flashcard', 'questionImages', '__empty', '__proto__', 'constructor', 'prototype'
]);

export function validBankName(name) {
    return typeof name === 'string' && !!name.trim() && !/[.#$\[\]/\x00-\x1f\x7f]/u.test(name)
        && !reservedBankKeys.has(name) && new TextEncoder().encode(name).length <= 768;
}

export function bankTitle(key, catalog) {
    const title = catalog?.[key]?.title;
    return typeof title === 'string' && title.trim() ? title : key || '';
}
