import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const path of ['index.html', 'support.html', 'privacy.html', 'manifest.webmanifest', 'sw.js', 'src', 'styles', 'Images', 'fonts']) await cp(path, `dist/${path}`, { recursive: true });
console.log('Built dist/ (local question banks, tests and Firebase exports excluded).');
