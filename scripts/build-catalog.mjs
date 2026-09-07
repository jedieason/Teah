import { readFile, writeFile } from 'node:fs/promises';
const [input, output] = process.argv.slice(2);
if (!input || !output || input === output) {
    console.error('Usage: npm run catalog -- firebase-export.json firebase/quiz-catalog.generated.json');
    process.exit(1);
}
const data = JSON.parse(await readFile(input, 'utf8'));
const reserved = new Set(['progress', 'mistakes', 'mistake', 'API_KEY', 'quizCatalog', 'quizAliases', 'config']);
const catalog = Object.fromEntries(Object.entries(data).filter(([key, value]) => !reserved.has(key) && Array.isArray(value))
    .map(([key, value]) => [key, { count: value.length, storageKey: data.quizCatalog?.[key]?.storageKey || key.replace(/^_Archive_/, '').replace(/\.json$/, '').replace(/[.$#[\]/]/g, '_') }]));
if (!Object.keys(catalog).length) throw new Error('No root-level question bank arrays found; export the Realtime Database root.');
await writeFile(output, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
console.log(`Generated catalog for ${Object.keys(catalog).length} banks. Import at /quizCatalog, not at the database root.`);
