import { GoogleGenAI } from '@google/genai';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

export function getApiKey() {
    return process.env.GEMINI_API_KEY || '';
}

export async function createGeminiStream({
    model = DEFAULT_MODEL,
    contents,
    config,
    apiKey = getApiKey(),
}) {
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured on the server.');
    }
    const ai = new GoogleGenAI({ apiKey });
    return await ai.models.generateContentStream({
        model,
        contents,
        config,
    });
}

export async function POST(req) {
    try {
        const body = await req.json();
        const apiKey = getApiKey() || body.apiKey;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-transform',
                }
            });
        }

        let model = body.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
        if (model === 'gemini-flash-lite-latest') model = DEFAULT_MODEL;

        const contents = body.contents || [{ role: 'user', parts: [{ text: body.prompt || '' }] }];
        const config = { ...body.config };
        if (body.systemInstruction && !config.systemInstruction) config.systemInstruction = body.systemInstruction;
        if (body.generationConfig) Object.assign(config, body.generationConfig);

        const geminiStream = await createGeminiStream({
            model,
            contents,
            config,
            apiKey,
        });

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of geminiStream) {
                        const text = chunk.text;
                        if (text) {
                            controller.enqueue(encoder.encode(text));
                        }
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no',
            },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message || 'Stream generation failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export async function handleNodeGeminiStream(req, res) {
    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? JSON.parse(raw) : {};

        const apiKey = getApiKey() || body.apiKey;
        if (!apiKey) {
            res.writeHead(500, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-transform',
            });
            res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on the server.' }));
            return;
        }

        let model = body.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
        if (model === 'gemini-flash-lite-latest') model = DEFAULT_MODEL;

        const contents = body.contents || [{ role: 'user', parts: [{ text: body.prompt || '' }] }];
        const config = { ...body.config };
        if (body.systemInstruction && !config.systemInstruction) config.systemInstruction = body.systemInstruction;
        if (body.generationConfig) Object.assign(config, body.generationConfig);

        const geminiStream = await createGeminiStream({
            model,
            contents,
            config,
            apiKey,
        });

        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        });

        let closed = false;
        req.on('close', () => { closed = true; });

        for await (const chunk of geminiStream) {
            if (closed) break;
            const text = chunk.text;
            if (text) {
                res.write(text);
            }
        }
        res.end();
    } catch (error) {
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message || 'Stream generation failed' }));
        } else {
            res.end();
        }
    }
}
