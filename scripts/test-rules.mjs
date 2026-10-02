// Use the supported CLI on Java 21+, or an already installed compatible Database Emulator on Java 17.
import { spawn, spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
const version = spawnSync('java', ['-version'], { encoding: 'utf8' });
const major = Number((version.stderr + version.stdout).match(/version "(\d+)/)?.[1]);
function run(command, args, env = process.env) {
    return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', env }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))); });
}
if (major >= 21) await run('node_modules/.bin/firebase', ['emulators:exec', '--only', 'database', '--project', 'demo-teah', 'node tests/rules.emulator.mjs']);
else {
    const cacheDir = join(homedir(), '.cache/firebase/emulators');
    let jars = []; try { jars = (await readdir(cacheDir)).filter(n => /^firebase-database-emulator-v4\..*\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch {}
    if (major < 17 || !jars.length) throw new Error('Rules tests require Java 21+, or Java 17 with an already downloaded compatible Database Emulator v4.');
    const port = await new Promise((resolve, reject) => { const socket = createServer(); socket.on('error', reject); socket.listen(0, '127.0.0.1', () => { const p = socket.address().port; socket.close(() => resolve(p)); }); });
    const emulator = spawn('java', ['-jar', join(cacheDir, jars[0]), '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Database Emulator did not start within 30 seconds.')), 30000);
            const check = data => { output += data.toString(); if (/Error initializing|Address already in use/.test(output)) { clearTimeout(timeout); reject(new Error('Database Emulator could not bind its test port.')); } if (/Listening at/.test(output)) { clearTimeout(timeout); resolve(); } };
            emulator.stdout.on('data', check); emulator.stderr.on('data', check); emulator.on('error', error => { clearTimeout(timeout); reject(error); }); emulator.on('exit', code => { clearTimeout(timeout); reject(new Error(`Database Emulator exited ${code}. ${output}`)); });
        });
        // The log precedes socket binding. Probe the actual socket before uploading rules.
        const deadline = Date.now() + 30000;
        while (true) {
            const ready = await new Promise(resolve => { const socket = connect({ host: '127.0.0.1', port }); socket.setTimeout(250); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); socket.on('timeout', () => { socket.destroy(); resolve(false); }); });
            if (ready) break;
            if (Date.now() > deadline || emulator.exitCode != null) throw new Error('Database Emulator socket did not become ready.');
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        await run(process.execPath, ['tests/rules.emulator.mjs'], { ...process.env, TEAH_RULES_PORT: String(port) });
    } finally { emulator.kill('SIGTERM'); }
}
