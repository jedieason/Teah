let worker, sequence = 0;
const pending = new Map();

export function resetEquivalence() {
    worker?.terminate(); worker = null;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('Inference cancelled')); }
    pending.clear();
}

export function inferEquivalence(pair, onProgress) {
    if (!worker) {
        worker = new Worker(new URL('./equivalence-worker.js', import.meta.url), { type: 'module' });
        worker.onerror = resetEquivalence;
        worker.onmessage = ({ data }) => {
            const request = pending.get(data.id); if (!request) return;
            if (data.progress) { request.onProgress?.(data.progress); return; }
            clearTimeout(request.timer); pending.delete(data.id);
            if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
        };
    }
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        // Initial model download can take minutes. Terminate timed-out work so retry is safe.
        const timer = setTimeout(resetEquivalence, 240000);
        pending.set(id, { resolve, reject, timer, onProgress });
        worker.postMessage({ id, pair });
    });
}
