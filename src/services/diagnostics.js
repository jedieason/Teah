// Local diagnostics contain categories and durations only, never question text, tokens or URLs.
const key = 'teah-diagnostics-v1';
export function diagnostic(kind, detail = {}) {
    try { const rows = JSON.parse(localStorage.getItem(key) || '[]'); rows.push({ at: Date.now(), kind, ...detail }); localStorage.setItem(key, JSON.stringify(rows.slice(-100))); } catch {}
}
export function diagnosticReport() { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
window.addEventListener('error', () => diagnostic('browser-error'));
window.addEventListener('unhandledrejection', () => diagnostic('unhandled-operation'));
window.addEventListener('sync-status', e => diagnostic(e.detail.error ? 'sync-failure' : 'sync-status', { pending: e.detail.pending ?? null }));
