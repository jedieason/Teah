function buildDirectPayload({ contents, config }) {
    const body = { contents };
    if (config) {
        if (config.systemInstruction) {
            body.systemInstruction = typeof config.systemInstruction === 'string'
                ? { parts: [{ text: config.systemInstruction }] }
                : config.systemInstruction;
        }
        const genConfig = {};
        if (config.temperature !== undefined) genConfig.temperature = config.temperature;
        if (config.maxOutputTokens !== undefined) genConfig.maxOutputTokens = config.maxOutputTokens;
        if (config.responseMimeType !== undefined) genConfig.responseMimeType = config.responseMimeType;
        if (config.responseSchema !== undefined) genConfig.responseSchema = config.responseSchema;
        if (Object.keys(genConfig).length > 0) body.generationConfig = genConfig;
    }
    return body;
}

export async function streamGemini({
    contents,
    config,
    model = 'gemini-2.5-flash-lite',
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

    let response;
    let isSse = false;
    let useDirect = false;

    // 1. Try server backend endpoint first
    try {
        const payload = { contents, config, model };
        if (apiKey) payload.apiKey = apiKey;

        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });

        // If backend returned 404, 405 (static host like GitHub Pages/Firebase Hosting), or 500 when apiKey is available
        if ((response.status === 404 || response.status === 405 || response.status >= 500) && apiKey) {
            useDirect = true;
        }
    } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') throw err;
        if (apiKey) {
            useDirect = true;
        } else {
            throw err;
        }
    }

    // 2. Fall back to upstream Gemini SSE streaming if static host or server endpoint unavailable
    if (useDirect) {
        const targetModel = model === 'gemini-flash-lite-latest' ? 'gemini-2.5-flash-lite' : (model || 'gemini-2.5-flash-lite');
        const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const directBody = buildDirectPayload({ contents, config });

        response = await fetch(directUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(directBody),
            signal,
        });
        isSse = true;
    }

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let message = `HTTP ${response.status}`;
        try {
            const parsed = JSON.parse(errorText);
            if (parsed.error?.message) {
                message = parsed.error.message;
            } else if (parsed.error) {
                message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
            }
        } catch {
            if (errorText) {
                message = errorText.includes('<html') ? `HTTP ${response.status} (服務未就緒)` : errorText;
            }
        }
        throw new Error(message);
    }

    if (!response.body) {
        throw new Error('Streaming response body unavailable');
    }

    if (response.headers.get('content-type')?.includes('text/event-stream')) {
        isSse = true;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';
    let started = false;
    let sseBuffer = '';

    const handleDelta = (text) => {
        if (!text) return;
        if (!started) {
            started = true;
            onStart?.();
        }
        assistantText += text;
        onDelta?.(text, assistantText);
    };

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

            const textChunk = decoder.decode(value, { stream: true });
            if (!textChunk) continue;

            if (isSse) {
                sseBuffer += textChunk;
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (!jsonStr) continue;
                    try {
                        const parsed = JSON.parse(jsonStr);
                        const delta = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
                        handleDelta(delta);
                    } catch {}
                }
            } else {
                handleDelta(textChunk);
            }

            if (signal?.aborted) {
                const abortErr = new Error('Request aborted');
                abortErr.name = 'AbortError';
                abortErr.partialText = assistantText;
                try { await reader.cancel(); } catch {}
                throw abortErr;
            }
        }

        // Flush any remaining SSE buffer
        if (isSse && sseBuffer.trim().startsWith('data:')) {
            const jsonStr = sseBuffer.trim().slice(5).trim();
            if (jsonStr) {
                try {
                    const parsed = JSON.parse(jsonStr);
                    const delta = parsed.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
                    handleDelta(delta);
                } catch {}
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
