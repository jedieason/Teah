export async function streamGemini({
    contents,
    config,
    model,
    apiKey,
    signal,
    onDelta,
    onStart,
    endpoint = '/api/chat',
}) {
    if (signal?.aborted) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        abortErr.partialText = '';
        throw abortErr;
    }

    const payload = { contents, config, model };
    if (apiKey) payload.apiKey = apiKey;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let message = `HTTP ${response.status}`;
        try {
            const parsed = JSON.parse(errorText);
            if (parsed.error) message = parsed.error;
        } catch {
            if (errorText) message = errorText;
        }
        throw new Error(message);
    }

    if (!response.body) {
        throw new Error('Streaming response body unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    let started = false;

    try {
        while (true) {
            if (signal?.aborted) {
                const abortErr = new Error('Request aborted');
                abortErr.name = 'AbortError';
                abortErr.partialText = assistantText;
                try { await reader.cancel(); } catch {}
                throw abortErr;
            }

            const { value, done } = await reader.read();
            if (done) break;

            const delta = decoder.decode(value, { stream: true });
            if (!delta) continue;

            if (!started) {
                started = true;
                onStart?.();
            }

            assistantText += delta;
            onDelta?.(delta, assistantText);

            if (signal?.aborted) {
                const abortErr = new Error('Request aborted');
                abortErr.name = 'AbortError';
                abortErr.partialText = assistantText;
                try { await reader.cancel(); } catch {}
                throw abortErr;
            }
        }
    } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') {
            try { await reader.cancel(); } catch {}
            const abortErr = new Error('Request aborted');
            abortErr.name = 'AbortError';
            abortErr.partialText = assistantText;
            throw abortErr;
        }
        err.partialText = assistantText;
        throw err;
    } finally {
        reader.releaseLock?.();
    }

    return assistantText;
}
