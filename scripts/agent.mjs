import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { createContentService } from './agent/content.mjs';
import { createDatabase } from './agent/firebase.mjs';
import { createAgentServer, listenOnLoopback } from './agent/http.mjs';

const homeConfig = join(homedir(), '.config', 'teah', 'agent.env');
const [command = 'help', ...args] = process.argv.slice(2);
const operations = { import: '/v1/banks/import', edit: '/v1/banks/edit', rename: '/v1/banks/rename', image: '/v1/images' };

async function readInput(path, maxBytes) {
    const input = path === '-' ? process.stdin : createReadStream(path);
    let size = 0;
    const chunks = [];
    for await (const chunk of input) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('輸入檔案太大。');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function run() {
    if (command === 'help') {
        console.log('npm run --silent agent -- list | get <題庫鍵> | import|edit|rename <JSON 檔或 -> [--apply] | image <圖檔> [--apply]\n文件在 docs/agent-question-banks.md。');
        return;
    }
    const [parameter, flag] = args;
    if (['serve', 'list'].includes(command) ? args.length !== 0 : !parameter || args.length > 2 || (flag !== undefined && flag !== '--apply') || (command === 'get' && flag) || (command !== 'get' && !Object.hasOwn(operations, command))) {
        throw new Error('指令或參數無效。請執行 npm run --silent agent -- help。');
    }

    const config = process.env.TEAH_AGENT_CONFIG || homeConfig;
    try {
        const permissions = await stat(config);
        if ((permissions.mode & 0o077) !== 0) throw new Error('Agent 設定檔權限需限制為 600。');
        if (typeof process.loadEnvFile !== 'function') throw new Error('載入 Agent 設定檔需要 Node.js 22 或更新版本。');
        process.loadEnvFile(config);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const { TEAH_DATABASE_URL, TEAH_AGENT_TOKEN, TEAH_AGENT_PORT } = process.env;
    if (!TEAH_DATABASE_URL || !TEAH_AGENT_TOKEN) throw new Error(`請在 ${config} 設定 Firebase URL 與機器憑證。`);
    const server = createAgentServer(createContentService(createDatabase(TEAH_DATABASE_URL)), TEAH_AGENT_TOKEN);
    if (command === 'serve') {
        const port = Number(TEAH_AGENT_PORT || 4191);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TEAH_AGENT_PORT 無效。');
        console.log(`Teah Agent API ${await listenOnLoopback(server, port)}/v1`);
        return;
    }

    let path, body;
    if (command === 'list') path = '/v1/banks';
    else if (command === 'get') path = `/v1/bank?${new URLSearchParams({ key: parameter })}`;
    else {
        path = operations[command];
        if (command === 'image') {
            const contentType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(parameter).toLowerCase()];
            if (!contentType) throw new Error('圖片需為 PNG、JPEG 或 WebP。');
            const bytes = await readInput(parameter, 512 * 1024);
            body = { contentType, base64: bytes.toString('base64') };
        } else {
            const parsed = JSON.parse((await readInput(parameter, 8 * 1024 * 1024)).toString('utf8'));
            if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('請求 JSON 必須是物件。');
            body = parsed;
        }
        body.apply = flag === '--apply';
    }

    const address = await listenOnLoopback(server, 0);
    try {
        const headers = { Authorization: `Bearer ${TEAH_AGENT_TOKEN}` };
        if (body) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${address}${path}`, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
        console.log(JSON.stringify(await response.json(), null, 2));
        if (!response.ok) process.exitCode = 1;
    } finally { server.close(); }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
