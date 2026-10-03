import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, getApiKey } from '../src/server/gemini.js';
import { streamGemini } from '../src/services/gemini-stream.js';

test('server POST returns 500 with descriptive error when no GEMINI_API_KEY is provided', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
        const req = new Request('http://localhost/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] }),
        });
        const res = await POST(req);
        assert.equal(res.status, 500);
        const data = await res.json();
        assert.match(data.error, /GEMINI_API_KEY is not configured/);
    } finally {
        if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    }
});

test('streamGemini consumes stream chunks and invokes onStart and onDelta', async () => {
    const chunks = ['Hello ', 'world! ', 'This is a stream.'];
    const encoder = new TextEncoder();
    const mockStream = new ReadableStream({
        async start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        }
    });

    const originalFetch = globalThis.fetch;
    const deltas = [];
    let startCalled = false;

    try {
        globalThis.fetch = async () => new Response(mockStream, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            }
        });

        const result = await streamGemini({
            contents: [{ parts: [{ text: 'test' }] }],
            onStart: () => { startCalled = true; },
            onDelta: (delta, accumulated) => { deltas.push({ delta, accumulated }); },
        });

        assert.equal(startCalled, true);
        assert.equal(result, 'Hello world! This is a stream.');
        assert.equal(deltas.length, 3);
        assert.equal(deltas[0].delta, 'Hello ');
        assert.equal(deltas[0].accumulated, 'Hello ');
        assert.equal(deltas[1].delta, 'world! ');
        assert.equal(deltas[1].accumulated, 'Hello world! ');
        assert.equal(deltas[2].delta, 'This is a stream.');
        assert.equal(deltas[2].accumulated, 'Hello world! This is a stream.');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('streamGemini handles cancellation via AbortController and preserves partialText', async () => {
    const encoder = new TextEncoder();
    const abortController = new AbortController();

    const mockStream = new ReadableStream({
        async start(controller) {
            controller.enqueue(encoder.encode('Part 1, '));
            controller.enqueue(encoder.encode('Part 2, '));
            // Simulate waiting
            await new Promise(r => setTimeout(r, 50));
            controller.enqueue(encoder.encode('Part 3'));
            controller.close();
        }
    });

    const originalFetch = globalThis.fetch;
    const received = [];

    try {
        globalThis.fetch = async () => new Response(mockStream, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });

        const streamPromise = streamGemini({
            contents: [{ parts: [{ text: 'test' }] }],
            signal: abortController.signal,
            onDelta: (delta) => {
                received.push(delta);
                if (received.length === 2) {
                    abortController.abort();
                }
            },
        });

        await assert.rejects(async () => {
            await streamPromise;
        }, (err) => {
            assert.equal(err.name, 'AbortError');
            assert.equal(err.partialText, 'Part 1, Part 2, ');
            return true;
        });

        assert.equal(received.join(''), 'Part 1, Part 2, ');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('streamGemini throws descriptive error on non-ok HTTP responses', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
        });

        await assert.rejects(async () => {
            await streamGemini({ contents: [] });
        }, (err) => {
            assert.match(err.message, /Rate limit exceeded/);
            return true;
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('streamGemini falls back to direct Gemini SSE stream when endpoint returns 405 on static hosting', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];
    const encoder = new TextEncoder();

    const mockSseStream = new ReadableStream({
        async start(controller) {
            controller.enqueue(encoder.encode('data: {"candidates": [{"content": {"parts": [{"text": "Direct "}]}}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"candidates": [{"content": {"parts": [{"text": "stream!"}]}}]}\n\n'));
            controller.close();
        }
    });

    try {
        globalThis.fetch = async (url, opts) => {
            fetchCalls.push({ url, opts });
            if (url === '/api/chat') {
                return new Response('<html><head><title>405 Not Allowed</title></head></html>', {
                    status: 405,
                    headers: { 'Content-Type': 'text/html' }
                });
            }
            if (String(url).includes('streamGenerateContent')) {
                return new Response(mockSseStream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not found', { status: 404 });
        };

        const deltas = [];
        const result = await streamGemini({
            contents: [{ parts: [{ text: 'test' }] }],
            apiKey: 'mock-key',
            onDelta: (delta) => deltas.push(delta),
        });

        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[0].url, '/api/chat');
        assert.match(String(fetchCalls[1].url), /generativelanguage\.googleapis\.com.*streamGenerateContent.*alt=sse/);
        assert.equal(result, 'Direct stream!');
        assert.deepEqual(deltas, ['Direct ', 'stream!']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
