import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
for (const file of [...walk('src'), ...walk('scripts')].filter(f => /\.(js|mjs)$/.test(f))) execFileSync(process.execPath, ['--check', file]);
const html = readFileSync('index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML IDs');
for (const tag of ['head', 'body', 'html']) assert.equal((html.match(new RegExp(`</${tag}>`, 'g')) || []).length, 1);
console.log('JavaScript syntax and HTML structure checks passed.');
