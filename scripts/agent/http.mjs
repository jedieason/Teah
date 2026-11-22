import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AgentError } from './content.mjs';

const maxBody = 8 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest();

async function readBody(request) {
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        throw new AgentError(415, 'unsupported_media_type', '請使用 application/json。');
    }
    if (Number(request.headers['content-length']) > maxBody) throw new AgentError(413, 'too_large', '請求不可超過 8 MiB。');
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBody) throw new AgentError(413, 'too_large', '請求不可超過 8 MiB。');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new AgentError(400, 'invalid_json', '請求不是有效 JSON。'); }
}

export function createAgentServer(content, token) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('TEAH_AGENT_TOKEN 需要至少 32 個字元的隨機字串。');
    const expected = digest(`Bearer ${token}`);
    const mutations = new Map([
        ['/v1/banks/import', content.import], ['/v1/banks/edit', content.edit], ['/v1/banks/rename', content.rename], ['/v1/images', content.image]
    ]);
    const server = createServer(async (request, response) => {
        const respond = (status, value) => {
            response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(value));
        };
        try {
            if (request.headers.origin || !timingSafeEqual(expected, digest(request.headers.authorization || ''))) {
                throw new AgentError(401, 'unauthorized', '缺少有效的 Agent 憑證。');
            }
            const url = new URL(request.url, 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/v1/banks') return respond(200, await content.list());
            if (request.method === 'GET' && url.pathname === '/v1/bank') return respond(200, await content.get(url.searchParams.get('key')));
            if (request.method === 'POST' && mutations.has(url.pathname)) return respond(200, await mutations.get(url.pathname)(await readBody(request)));
            throw new AgentError(404, 'route_not_found', '找不到此端點。');
        } catch (error) {
            if (error instanceof AgentError) respond(error.status, { error: error.code, message: error.message });
            else respond(500, { error: 'internal_error', message: 'Agent 端點無法完成請求。' });
        }
    });
    server.requestTimeout = 30000;
    return server;
}

export async function listenOnLoopback(server, port) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    return `http://127.0.0.1:${server.address().port}`;
}
