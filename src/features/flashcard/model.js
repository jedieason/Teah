import { gradingLevel, gradingOptions } from './grading-options.js';
// Independent vocabulary sets. Quizlet's undisclosed coefficients are not used.
export const MAX_CARDS = 2000;
export const LEARN_VERSION = 3;
export const RECOGNITION_WINDOW = 10;
export const DEFAULT_OPTIONS = { activity: 'learn', direction: 'term', scope: 'all', shuffle: false, goal: 'master', types: ['choice', 'multi', 'written'], grading: 'standard', defaultLanguage: 'zh-TW', retype: false, audio: false, audioAnswer: false, audioSide: 'term', audioRate: 0.9, sound: true, chunkSize: 7, familiarity: 'new', practice: false };
export const id = () => crypto.randomUUID();
export const clone = value => JSON.parse(JSON.stringify(value));
export const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export const plainText = value => String(value ?? '').replace(/\*\*(.+?)\*\*|__(.+?)__|==(.+?)==|\*([^*]+?)\*/gs, (_, a, b, c, d) => a || b || c || d);

const isCJK = ch => /[\u4e00-\u9fa5\u3040-\u30ff]/.test(ch);

export function expandParentheses(text) {
    const raw = String(text ?? '');
    const regex = /\([^()]*\)|（[^（）]*）|\[[^\[\]]*\]|【[^【】]*】|\{[^{}]*\}|｛[^｛｝]*｝|〔[^〔〕]*〕|〖[^〖〗]*〗/g;
    const matches = [...raw.matchAll(regex)];
    if (!matches.length) return [raw];
    let variants = [''];
    let lastIndex = 0;
    for (const match of matches) {
        const before = raw.slice(lastIndex, match.index);
        const inside = match[0].slice(1, -1);
        const nextVariants = [];
        for (const v of variants) {
            nextVariants.push(v + before);
            const needsSpace = v || before ? !isCJK((v + before).slice(-1)) && !isCJK(inside.slice(0, 1)) : false;
            nextVariants.push(v + before + (needsSpace ? ' ' : '') + inside);
        }
        variants = nextVariants.slice(0, 32);
        lastIndex = match.index + match[0].length;
    }
    const tail = raw.slice(lastIndex);
    const results = variants.map(v => {
        const needsSpace = tail && v && !v.endsWith(' ') && !tail.startsWith(' ') && !isCJK(v.slice(-1)) && !isCJK(tail.slice(0, 1));
        return (v + (needsSpace ? ' ' : '') + tail).replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    return [...new Set(results.length ? results : [raw])];
}

export function answerKey(value) {
    let s = normalize(plainText(value));
    s = s.replace(/["'“”‘’`「」『』]/g, '');
    s = s.replace(/[，,、;；…~～—–\(\)（）\[\]【】\{\}｛｝〔〕〖〗《》!?！？]/g, ' ');
    s = s.replace(/(?<!\d):|:(?!\d)|：/g, ' ');
    s = s.replace(/\.(?!\d)|。/g, ' ');
    s = s.replace(/(?<=\p{L})[-—–_](?=\p{L})/gu, ' ');
    s = s.replace(/(?<=[\u4e00-\u9fa5\u3040-\u30ff])\s+(?=[\u4e00-\u9fa5\u3040-\u30ff])/g, '');
    return s.replace(/\s+/g, ' ').trim();
}
export function gradeAnswer(input, answers, grading = 'strict') {
    const inputKeys = expandParentheses(input).map(answerKey).map(k => k.replace(/\s/g, '')).filter(Boolean);
    if (!inputKeys.length) return false;
    const allExpected = (answers || []).flatMap(expandParentheses);
    if (grading === 'exact') {
        return inputKeys.some(key => allExpected.some(a => answerKey(a).replace(/\s/g, '') === key));
    }
    return inputKeys.some(key => {
        return allExpected.some(answer => {
            const expected = answerKey(answer);
            const expectedKey = expected.replace(/\s/g, '');
            if (key === expectedKey) return true;
            if (grading !== 'moderate' || /[\d+−=<>/]/.test(expected) || /[^a-zÀ-ž\s-]/i.test(expected)) return false;
            const strip = s => s.normalize('NFD').replace(/\p{M}/gu, '');
            const a = strip(key), b = strip(expected);
            if (a === b) return true;
            // Short words accept an omitted/extra letter, but not a different same-length word.
            if (b.length < 3 || a.length === b.length && b.length < 5) return false;
            if (Math.abs(a.length - b.length) > 1) return false;
            let i = 0, j = 0, errors = 0;
            while (i < a.length && j < b.length) {
                if (a[i] === b[j]) { i++; j++; continue; }
                if (++errors > 1) return false;
                if (a.length >= b.length) i++;
                if (b.length >= a.length) j++;
            }
            return errors + (a.length - i) + (b.length - j) <= 1;
        });
    });
}
export const FLASHCARD_IMPORT_PROMPT = `請將以下學習內容整理為單字卡 JSON 陣列。

格式要求：
[
  {
    "term": "單字或概念",
    "definition": "解釋或詳細說明"
  }
]

注意事項：
1. 每張字卡包含 "term"（正面）與 "definition"（背面）。
2. 若內容或解釋有多行（例如詞性、中文解釋、例句說明），請在字串內使用 \\n 表示換行（例如："n. 蘋果\\n甜甜白白的"）。
3. 只需輸出標準 JSON 陣列，不要加入 Markdown 語法區塊（如 \`\`\`json）或其他對話文字。

內容如下：
`;

function delimiters(options) {
    const decode = s => (s || '').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const term = decode(options.term === 'tab' ? '\t' : options.term === 'comma' ? ',' : options.term === 'dash' ? '-' : options.termCustom);
    const row = decode(options.row === 'newline' ? '\n' : options.row === 'semicolon' ? ';' : options.rowCustom);
    if (!term || !row || term === row || term.length > 20 || row.length > 20) throw new Error('請設定不同且非空的分隔符號（最多 20 字元）。');
    return { term, row };
}
export function parseImportJson(text) {
    const input = String(text ?? '').replace(/^\uFEFF/, '').trim();
    if (!input) return { cards: [], errors: [], duplicates: 0 };
    if (input.length > 4000000) throw new Error('匯入文字超過 4 MB，請分批匯入。');
    let raw = input;
    if (raw.startsWith('```')) {
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('JSON 格式錯誤，請確認內容符合 JSON 語法。');
    }
    const list = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.cards)
            ? parsed.cards
            : (Array.isArray(parsed?.deck?.cards) ? parsed.deck.cards : null));
    if (!list) {
        throw new Error('JSON 必須為字卡陣列或包含 cards 陣列的物件。');
    }
    const decode = s => String(s ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
    const cards = [], errors = [];
    for (const [i, item] of list.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push({ row: i + 1, message: '字卡項目格式不正確' });
            continue;
        }
        const termVal = item.term ?? item.word ?? item.front ?? item.question ?? '';
        const defVal = item.definition ?? item.meaning ?? item.back ?? item.answer ?? '';
        const a = decode(termVal).trim();
        const b = decode(defVal).trim();
        const card = { term: a, definition: b };
        if (Array.isArray(item.termAliases)) {
            card.termAliases = item.termAliases.map(v => decode(v).trim()).filter(Boolean);
        }
        if (Array.isArray(item.definitionAliases)) {
            card.definitionAliases = item.definitionAliases.map(v => decode(v).trim()).filter(Boolean);
        }
        cards.push(card);
        if (!a || !b) errors.push({ row: i + 1, message: '單字或解釋為空白' });
        if (a.length > 4000 || b.length > 4000) errors.push({ row: i + 1, message: '單面最多 4000 字元' });
        if (cards.length > MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張字卡。`);
    }
    const seen = new Set(); let duplicates = 0;
    for (const c of cards) { const key = normalize(c.term) + '\u0000' + normalize(c.definition); if (seen.has(key)) duplicates++; seen.add(key); }
    return { cards, errors, duplicates };
}
export function parseImport(text, options = { term: 'tab', row: 'newline' }) {
    if (options?.format === 'json') return parseImportJson(text);
    const { term, row } = delimiters(options);
    const input = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (input.length > 4000000) throw new Error('匯入文字超過 4 MB，請分批匯入。');
    // Teah's delimiter parser preserves the definition after the first separator.
    const cards = [], errors = [];
    const decode = s => String(s ?? '')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
    for (const [i, line] of input.split(row).entries()) {
        if (!line.trim()) continue;
        const cut = line.indexOf(term);
        const a = decode(cut < 0 ? line.trim() : line.slice(0, cut).trim()).trim();
        const b = decode(cut < 0 ? '' : line.slice(cut + term.length).trim()).trim();
        cards.push({ term: a, definition: b });
        if (!a || !b) errors.push({ row: i + 1, message: cut < 0 ? '找不到單字與解釋的分隔符號' : '單字或解釋為空白' });
        if (a.length > 4000 || b.length > 4000) errors.push({ row: i + 1, message: '單面最多 4000 字元' });
        if (cards.length > MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張字卡。`);
    }
    const seen = new Set(); let duplicates = 0;
    for (const c of cards) { const key = normalize(c.term) + '\u0000' + normalize(c.definition); if (seen.has(key)) duplicates++; seen.add(key); }
    return { cards, errors, duplicates };
}
export function detectLanguage(samples, fallback = 'en-US') {
    const list = Array.isArray(samples) ? samples : [samples];
    const text = list.map(s => String(s ?? '')).join(' ').trim();
    if (!text) return fallback;

    if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text)) return 'ko-KR';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja-JP';

    const cjkMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
    const latinMatches = text.match(/[A-Za-z]/g) || [];
    if (cjkMatches.length > 0 && cjkMatches.length >= latinMatches.length * 0.35) {
        return 'zh-TW';
    }

    const mathCmds = (text.match(/\\(frac|sum|int|sqrt|alpha|beta|gamma|Delta|theta|pi|sigma|omega|pm|times|div|approx|neq|leq|geq|partial|infty)\b/gi) || []).length;
    const mathSymbols = (text.match(/[=+\-*/^_{}\\]|[\u0370-\u03ff\u2190-\u22ff\u2a00-\u2aff]/g) || []).length;
    const chemicalPatterns = (text.match(/\b([A-Z][a-z]?\d*)+(\^?[+-]\d*)?\b/g) || []).filter(w => /(?:H2O|CO2|NaCl|Ca2\+|Fe[23]\+|SO4|CH4|O2|N2|HCl|NaOH|H2SO4|KNO3)/i.test(w)).length;
    if (mathCmds >= 1 || chemicalPatterns >= 1 || (mathSymbols >= 3 && latinMatches.length < 10)) {
        return 'math';
    }

    let deScore = 0, frScore = 0, esScore = 0, itScore = 0, msScore = 0, laScore = 0, enScore = 0;

    if (/[äöüßÄÖÜ]/.test(text)) deScore += 8;
    if (/[œæçŒÆÇ]/.test(text)) frScore += 8;
    if (/[ñÑ¡¿]/.test(text)) esScore += 8;
    if (/\b(?:qu'|d'|c'|j'|l'|m'|n'|s'|t')/i.test(text)) frScore += 6;

    const words = text.toLowerCase().match(/\b[\p{L}\p{M}'-]+\b/gu) || [];
    const msWords = new Set([
        'yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'saya', 'anda', 'mereka',
        'kita', 'kami', 'tidak', 'ada', 'pada', 'oleh', 'sudah', 'telah', 'akan', 'boleh', 'lebih',
        'seperti', 'kata', 'orang', 'hari', 'tahun', 'apa', 'siapa', 'mana', 'bagaimana', 'mengapa',
        'kerana', 'adalah', 'ialah', 'assalamualaikum', 'terima', 'kasih', 'selamat', 'pagi', 'malam',
        'petang', 'buku', 'makan', 'minum', 'tidur', 'rumah', 'jalan', 'besar', 'kecil', 'bagus',
        'baik', 'cantik', 'sedap', 'nama', 'bapa', 'ibu', 'kawan', 'guru', 'murid', 'sekolah',
        'bahasa', 'melayu', 'epal', 'air', 'ya', 'bukan', 'jangan', 'khabar', 'tengah', 'semalam',
        'esok', 'sekarang', 'semua', 'sedikit', 'banyak', 'sangat', 'paling', 'satu', 'dua', 'tiga'
    ]);

    const deWords = new Set([
        'der', 'die', 'das', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen', 'und', 'in', 'zu',
        'den', 'dem', 'nicht', 'von', 'mit', 'sich', 'auf', 'für', 'ist', 'im', 'ja', 'als', 'wie',
        'aber', 'oder', 'wir', 'sie', 'er', 'es', 'auch', 'an', 'so', 'nach', 'bei', 'noch', 'um',
        'du', 'nur', 'doch', 'vor', 'ihr', 'bis', 'mehr', 'durch', 'man', 'sein', 'wurde', 'haben',
        'hat', 'werden', 'wird', 'kann', 'können', 'danke', 'bitte', 'hallo', 'guten', 'morgen', 'tag', 'abend', 'apfel'
    ]);

    const frWords = new Set([
        'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'en', 'à', 'est', 'dans', 'pour',
        'avec', 'sur', 'pas', 'que', 'qui', 'ce', 'cette', 'ces', 'ne', 'se', 'par', 'ou', 'mais',
        'sont', 'plus', 'nous', 'vous', 'ils', 'elles', 'tout', 'faire', 'bonjour', 'merci', 'oui', 'non', 'pomme'
    ]);

    const esWords = new Set([
        'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'en', 'de', 'que', 'es', 'por',
        'para', 'con', 'no', 'se', 'su', 'al', 'lo', 'como', 'más', 'pero', 'del', 'o', 'si', 'me',
        'ya', 'le', 'todo', 'hola', 'gracias', 'adiós', 'buenos', 'días', 'noches', 'tardes', 'niño', 'niña'
    ]);

    const itWords = new Set([
        'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'e', 'di', 'a', 'da', 'in', 'con',
        'su', 'per', 'tra', 'fra', 'non', 'che', 'sono', 'perche', 'perché', 'questo', 'questa',
        'questi', 'queste', 'quello', 'quella', 'come', 'ma', 'se', 'anche', 'ci', 'si', 'ciao',
        'grazie', 'buongiorno', 'sera', 'notte', 'molto', 'bene'
    ]);

    const laWords = new Set([
        'et', 'in', 'non', 'ad', 'ut', 'cum', 'per', 'sed', 'ab', 'ex', 'si', 'de', 'sub', 'pro',
        'inter', 'contra', 'ante', 'post', 'sine', 'trans', 'super', 'apud', 'ergo', 'autem', 'enim',
        'nam', 'tamen', 'itaque', 'quia', 'quoniam', 'quam', 'sic', 'ita', 'tam', 'nunc', 'tunc',
        'semper', 'saepe', 'iterum', 'bene', 'male', 'multum', 'minime', 'magnus', 'parvus', 'bonus',
        'malus', 'novus', 'vetus', 'omnis', 'totus', 'solus', 'unus', 'duo', 'tres', 'deus', 'homo',
        'corpus', 'mors', 'vita', 'terra', 'caelum', 'lux', 'nox', 'dies', 'annus', 'tempus', 'res',
        'sunt', 'erat', 'fuit', 'est', 'populusque', 'senatus', 'romanorum', 'romanus'
    ]);

    const enWords = new Set([
        'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it', 'for', 'not', 'on', 'with',
        'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say',
        'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
        'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make',
        'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'people', 'into', 'year',
        'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look',
        'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
        'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
        'give', 'day', 'most', 'us', 'water', 'car', 'apple', 'hello', 'fruit'
    ]);

    for (const w of words) {
        if (msWords.has(w)) msScore += 3;
        if (deWords.has(w)) deScore += 3;
        if (frWords.has(w)) frScore += 3;
        if (esWords.has(w)) esScore += 3;
        if (itWords.has(w)) itScore += 3;
        if (laWords.has(w)) laScore += 3;
        if (enWords.has(w)) enScore += 3;

        if (/^(?:meng|mem|men|ber|ter|per)[\p{L}]{3,}/u.test(w) || /[\p{L}]{3,}(?:kan|nya|lah)$/u.test(w)) msScore += 1;
        if (/[\p{L}]{3,}(?:ibus|orum|arum|atus|atis|oque|aque)$/u.test(w)) laScore += 2;
        if (/[\p{L}]{3,}(?:zione|zioni|mento|mente)$/u.test(w)) itScore += 2;
        if (/[\p{L}]{3,}(?:ción|ciones|mente)$/u.test(w)) esScore += 2;
        if (/[\p{L}]{3,}(?:tion|tions|ment|ments|eur|euse)$/u.test(w)) frScore += 1;
        if (/[\p{L}]{3,}(?:ung|ungen|heit|keit|schaft)$/u.test(w)) deScore += 2;
        if (/[\p{L}]{3,}(?:ing|tion|ed|ness|ful|less)$/u.test(w)) enScore += 1;
    }

    const scores = [
        { lang: 'ms-MY', score: msScore },
        { lang: 'de-DE', score: deScore },
        { lang: 'fr-FR', score: frScore },
        { lang: 'es-ES', score: esScore },
        { lang: 'it-IT', score: itScore },
        { lang: 'la', score: laScore },
        { lang: 'en-US', score: enScore }
    ];

    scores.sort((a, b) => b.score - a.score);
    if (scores[0].score > 0) return scores[0].lang;

    if (cjkMatches.length > 0) return 'zh-TW';

    return fallback;
}
export function prepareDeck(draft, previous, now = Date.now()) {
    if (!draft.title?.trim() || draft.title.length > 160) throw new Error('請填寫字卡集名稱（最多 160 字）。');
    if (!draft.cards?.length || draft.cards.length > MAX_CARDS) throw new Error(`請加入 1–${MAX_CARDS} 張字卡。`);
    const used = new Set(), old = new Map(previous?.cards.map(c => [c.id, c]) || []);
    const cards = draft.cards.map(c => {
        if (!c.term?.trim() || !c.definition?.trim() || c.term.length > 4000 || c.definition.length > 4000) throw new Error('每張字卡需要單字與解釋，單面最多 4000 字。');
        const cardId = /^[a-zA-Z0-9_-]{1,80}$/.test(c.id || '') ? c.id : id();
        if (used.has(cardId)) throw new Error('字卡識別碼重複。'); used.add(cardId);
        const aliases = side => (c[side] || []).filter(a => a.trim()).map(a => a.trim());
        const next = { id: cardId, term: c.term.trim(), definition: c.definition.trim(), termAliases: aliases('termAliases'), definitionAliases: aliases('definitionAliases') };
        if (next.termAliases.length > 12 || next.definitionAliases.length > 12 || [...next.termAliases, ...next.definitionAliases].some(a => a.length > 4000)) throw new Error('每一面最多 12 個替代答案。');
        const prev = old.get(cardId);
        next.revision = prev ? prev.revision + (['term', 'definition', 'termAliases', 'definitionAliases'].some(k => JSON.stringify(next[k]) !== JSON.stringify(prev[k] || [])) ? 1 : 0) : 1;
        return next;
    });
    const deck = {
        id: previous?.id || draft.id || id(),
        title: draft.title.trim(),
        description: (draft.description || '').slice(0, 2000),
        termLanguage: draft.termLanguage || 'en-US',
        definitionLanguage: draft.definitionLanguage || 'zh-TW',
        cards,
        revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || now,
        updatedAt: now
    };
    if (draft.isPublic != null || previous?.isPublic != null) {
        deck.isPublic = !!(draft.isPublic ?? previous?.isPublic);
    }
    const authorId = draft.authorId || previous?.authorId;
    if (authorId) deck.authorId = String(authorId).slice(0, 128);
    const authorName = draft.authorName || previous?.authorName;
    if (authorName) deck.authorName = String(authorName).slice(0, 160);
    const authorPhoto = draft.authorPhoto ?? previous?.authorPhoto;
    if (authorPhoto) deck.authorPhoto = String(authorPhoto).slice(0, 2000);
    return deck;
}
export function shuffled(values, random = Math.random) {
    const list = [...values];
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
}
export const factKey = (cardId, direction) => `${cardId}_${direction}`;
export const answerFor = (card, direction) => direction === 'term' ? card.term : card.definition;
export const promptFor = (card, direction) => direction === 'term' ? card.definition : card.term;
export const answersFor = (card, direction) => [answerFor(card, direction), ...(direction === 'term' ? card.termAliases || [] : card.definitionAliases || [])];
export function defaultGrading(deck, defaultLanguage = DEFAULT_OPTIONS.defaultLanguage) {
    const language = value => String(value || '').toLowerCase().split('-')[0];
    const term = language(deck.termLanguage), definition = language(deck.definitionLanguage);
    if (term !== definition || ['zh', 'ja', 'math', 'chemistry', 'akkadian', 'photo'].includes(term)) return 'strict';
    return deck.cards.length >= 3 && ['en', 'fr', 'de', 'es'].includes(term) && term === language(defaultLanguage) ? 'relaxed' : 'moderate';
}
export const gradingFor = session => session.options.activity === 'spell' ? 'exact' : gradingLevel(session.options.grading);
export const activityName = session => session.options.activity === 'write' ? 'Write' : session.options.activity === 'spell' ? 'Spell' : 'Learn';
const writtenActivity = session => ['write', 'spell'].includes(session.options.activity);
const sessionCredit = (session, key) => writtenActivity(session) ? session.writeCredits[key] || 0 : creditOf(session.facts[key]);
export function hydrateSession(value) {
    const s = clone(value);
    if (s.mode !== 'flash') s.options = gradingOptions(s.options || DEFAULT_OPTIONS);
    if (s.current?.type === 'written' && s.feedback?.correct && s.feedback.response !== plainText(s.feedback.expected)) s.feedback.requiresAcknowledgement = true;
    s.order = Object.values(s.order || {});
    if (s.mode === 'flash') { s.ratings ||= {}; s.history = Object.values(s.history || {}); }
    else { s.active = Object.values(s.active || {}); s.scope = Object.values(s.scope || {}); s.roundAnswers = Object.values(s.roundAnswers || {}); s.options.types = Object.values(s.options.types || {}); if (s.options.learnTypes) s.options.learnTypes = Object.values(s.options.learnTypes); s.flowQueue = Object.values(s.flowQueue || {}); s.retryQueue = Object.values(s.retryQueue || {}); s.roundSeen = Object.values(s.roundSeen || {}); s.practiceQueue = Object.values(s.practiceQueue || {}); s.writeCredits ||= {}; s.passMisses = Object.values(s.passMisses || {}); }
    return s;
}
export function freshFact() { return { stage: 0, credit: 0, correct: 0, wrong: 0, streak: 0, lastAt: 0, interval: 0, dueAt: 0, lastOrdinal: -10 }; }
const creditOf = fact => fact.credit ?? fact.stage;
export function gradeFact(fact, correct, now, ordinal = 0) {
    const value = { ...freshFact(), ...fact };
    // Progress credit survives errors; mastery separately requires two consecutive correct retrievals.
    const credit = correct ? Math.min(2, creditOf(fact) + 1) : creditOf(fact), streak = correct ? value.streak + 1 : 0;
    const stage = credit === 0 ? 0 : streak >= 2 ? 2 : 1;
    const interval = correct && stage === 2 ? Math.min(90, Math.max(1, value.interval * 2, (now - (value.lastAt || now)) / 86400000 * 2)) : 0;
    return { stage, credit, correct: value.correct + Number(correct), wrong: value.wrong + Number(!correct), streak,
        lastAt: now, interval, dueAt: now + interval * 86400000, lastOrdinal: ordinal };
}
// Chronological event replay gives the same aggregates after offline retries or concurrent devices.
export function projectStudy(study = {}) {
    const events = Object.values(study.events || {}).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const undoneFlash = new Set(events.filter(e => e.kind === 'flash' && e.value === false && e.originalId).map(e => e.originalId));
    const overrides = new Map(events.filter(e => e.kind === 'override').map(e => [e.originalId, e]));
    const reset = events.filter(e => e.kind === 'reset').at(-1);
    const generation = reset?.generation || 'initial', facts = {}, flash = {}, stars = {};
    let correct = 0, wrong = 0;
    for (const e of events) {
        if (e.kind === 'star') { stars[e.cardId] = e.value; continue; }
        if (e.kind === 'flash' && (e.value === false || undoneFlash.has(e.id))) continue;
        if (e.kind === 'flash') { flash[factKey(e.cardId, e.direction)] = { known: e.correct, revision: e.revision, at: e.at }; continue; }
        if (e.kind !== 'answer' || (e.generation || 'initial') !== generation) continue;
        const key = factKey(e.cardId, e.direction), old = facts[key];
        if (old?.revision > e.revision) continue;
        const initial = e.initialStage === 1 ? 1 : 0;
        const base = old?.revision === e.revision ? old : { ...freshFact(), stage: initial, credit: initial, streak: initial };
        const effective = overrides.get(e.id)?.correct ?? e.correct;
        facts[key] = { ...gradeFact(base, effective, e.at, e.ordinal), revision: e.revision };
        correct += Number(effective); wrong += Number(!effective);
    }
    return { facts, flash, stars, generation, correct, wrong };
}
export function mergeStudy(previous, event, session) {
    const next = clone(previous || {}); next.events ||= {};
    if (event && !next.events[event.id]) next.events[event.id] = event;
    if (session) {
        next.sessions ||= {};
        const old = next.sessions[session.mode];
        if (!old || old.updatedAt < session.updatedAt || old.updatedAt === session.updatedAt && old.id <= session.id) next.sessions[session.mode] = session;
    }
    next.summary = projectStudy(next);
    return next;
}
function initialFact(card, direction, projected, options) {
    const key = factKey(card.id, direction), fact = projected.facts[key];
    if (fact?.revision === card.revision) return { ...fact, lastOrdinal: -10 };
    const known = !options.freshStart && projected.flash[key]?.revision === card.revision && projected.flash[key]?.known;
    const initial = known || options.familiarity === 'familiar' ? 1 : 0;
    return { ...freshFact(), stage: initial, credit: initial, streak: initial, revision: card.revision };
}
export function progressCounts(deck, projected, direction = 'term') {
    const counts = { new: 0, learning: 0, mastered: 0, due: 0, total: deck.cards.length };
    for (const card of deck.cards) {
        const dirs = direction === 'both' ? ['term', 'definition'] : [direction];
        const facts = dirs.map(d => initialFact(card, d, projected, DEFAULT_OPTIONS));
        const stage = Math.min(...facts.map(f => f.stage));
        counts[stage === 2 ? 'mastered' : stage === 1 ? 'learning' : 'new']++;
        if (facts.some(f => f.stage === 2 && f.dueAt <= Date.now())) counts.due++;
    }
    return counts;
}
export function createSession(deck, study = {}, input = {}, now = Date.now(), random = Math.random) {
    const options = gradingOptions({ ...DEFAULT_OPTIONS, ...input });
    if (!['learn', 'write', 'spell'].includes(options.activity)) options.activity = 'learn';
    if (options.activity !== 'learn') { options.goal = 'master'; options.types = [options.activity === 'spell' ? 'spell' : 'written']; }
    options.audioRate = options.audioRate === 0.65 ? 0.65 : 0.9;
    options.audioSide = ['term', 'definition', 'both'].includes(options.audioSide) ? options.audioSide : 'term';
    options.chunkSize = Math.max(3, Math.min(20, Number(options.chunkSize) || 7));
    options.types = [...new Set(options.types)].filter(t => ['choice', 'multi', 'written', 'truefalse', 'flash', 'spell'].includes(t));
    if (!options.types.length) throw new Error('請至少選擇一種題型。');
    const projected = projectStudy(study), facts = {}, scope = [];
    for (const card of deck.cards) {
        const dirs = options.direction === 'both' ? ['term', 'definition'] : [options.direction];
        const included = options.scope !== 'starred' || projected.stars[card.id];
        for (const direction of dirs) {
            const key = factKey(card.id, direction), fact = initialFact(card, direction, projected, options);
            if (!included || options.scope === 'learning' && fact.stage === 2 || options.scope === 'due' && !(fact.stage === 2 && fact.dueAt <= now)) continue;
            facts[key] = options.scope === 'due' ? { ...fact, stage: 1, credit: 1 } : options.scope === 'learning' && creditOf(fact) === 2 ? { ...fact, credit: 1 } : fact;
            scope.push({ key, cardId: card.id, direction });
        }
    }
    if (!scope.length) throw new Error('這個範圍沒有可練習的字卡。');
    const order = options.shuffle ? shuffled(scope.map(f => f.key), random) : scope.map(f => f.key);
    const flowQueue = [], goal = options.goal === 'quick' ? 1 : 2;
    // Recognition and recall are interleaved in bounded windows, independently of seven-question checkpoints.
    for (let i = 0; i < order.length; i += RECOGNITION_WINDOW) {
        const window = order.slice(i, i + RECOGNITION_WINDOW);
        flowQueue.push(...window.filter(key => creditOf(facts[key]) === 0).map(key => ({ key, target: 1 })));
        if (goal === 2) flowQueue.push(...window.filter(key => creditOf(facts[key]) < 2).map(key => ({ key, target: 2 })));
    }
    const session = { id: id(), version: LEARN_VERSION, mode: 'learn', deckId: deck.id, deckRevision: deck.revision, generation: projected.generation, options, scope, order, facts, flowQueue: options.activity === 'learn' ? flowQueue : [], writeCredits: Object.fromEntries(order.map(key => [key, 0])), passMisses: [], retryQueue: [], practiceQueue: [], roundSeen: [], roundRepair: false, active: [], chunk: 0, chunkTarget: 1, chunkGoals: {},
        ordinal: 0, round: 1, roundAnswers: [], lastKey: '', current: null, feedback: null, checkpoint: false, completed: false, createdAt: now, updatedAt: now };
    return selectNext(session, deck, now, random);
}
const goalStage = session => session.options.goal === 'quick' ? 1 : 2;
function binaryOptions(expected) {
    const match = /^(yes|no|true|false)(?:$|\s*[,.;:!?])/i.exec(plainText(expected).trim());
    if (!match) return null;
    const key = match[1].toLowerCase(), choices = ['yes', 'no'].includes(key) ? ['Yes', 'No'] : ['True', 'False'];
    return { choices, answer: choices.find(value => value.toLowerCase() === key) };
}
export function writingHint(expected) {
    const value = plainText(expected).trim(), chars = Array.from(value);
    if (chars.length < 4 || binaryOptions(value)) return '';
    if (chars.length > 80) {
        const prefix = chars.slice(0, Math.floor(chars.length / 2)).join('');
        return prefix.slice(0, prefix.lastIndexOf(' ') > 0 ? prefix.lastIndexOf(' ') : prefix.length) + '...';
    }
    const reveal = Math.ceil(chars.length / 3);
    return chars.slice(0, reveal).join('') + chars.slice(reveal).join('').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/[\p{L}\p{N}]/gu, '_').replace(/\s+/g, ' ');
}
export function writingSymbols(deck, direction) {
    const found = new Set();
    for (const card of deck.cards) for (const char of plainText(answerFor(card, direction)).match(/[\p{Script=Greek}\p{Script=Cyrillic}À-ÖØ-öø-ÿ±×÷≤≥∞∑√²³]/gu) || []) found.add(char.toLocaleLowerCase());
    return [...found].slice(0, 24);
}
export function spellingFeedback(response, expected) {
    const a = Array.from(plainText(response).trim()), b = Array.from(plainText(expected).trim());
    const parts = (chars, marks) => {
        const result = [];
        chars.forEach((text, i) => { const incorrect = !!marks[i]; if (result.at(-1)?.incorrect === incorrect) result.at(-1).text += text; else result.push({ text, incorrect }); });
        return result;
    };
    // Bounded edit alignment keeps long pasted answers from allocating an unbounded matrix.
    if (a.length > 256 || b.length > 256) return { response: parts(a, a.map(() => true)), expected: parts(b, b.map(() => true)) };
    const cost = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = 0; i <= a.length; i++) cost[i][0] = i;
    for (let j = 0; j <= b.length; j++) cost[0][j] = j;
    const same = (i, j) => a[i].toLocaleLowerCase() === b[j].toLocaleLowerCase();
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + Number(!same(i - 1, j - 1)));
    const wrongA = [], wrongB = []; let i = a.length, j = b.length;
    while (i || j) {
        if (i && j && cost[i][j] === cost[i - 1][j - 1] + Number(!same(i - 1, j - 1))) { if (!same(i - 1, j - 1)) { wrongA[i - 1] = true; wrongB[j - 1] = true; } i--; j--; }
        else if (i && cost[i][j] === cost[i - 1][j] + 1) wrongA[--i] = true;
        else wrongB[--j] = true;
    }
    return { response: parts(a, wrongA), expected: parts(b, wrongB) };
}
function planRound(session) {
    session.chunk++; session.chunkGoals = {}; session.roundSeen = [];
    if (writtenActivity(session)) {
        const pending = session.order.filter(key => sessionCredit(session, key) < 2);
        session.active = [...new Set([...session.passMisses.filter(key => pending.includes(key)), ...pending])];
        session.chunkGoals = Object.fromEntries(session.active.map(key => [key, 2]));
        session.chunkTarget = 2; session.roundRepair = false;
        return;
    }
    const take = queue => {
        while (queue.length && session.active.length < session.options.chunkSize) {
            const step = queue[0];
            if (creditOf(session.facts[step.key]) >= step.target) { queue.shift(); continue; }
            // Never reserve both recognition and recall of the same term in one round.
            if (session.active.includes(step.key)) break;
            queue.shift(); session.active.push(step.key); session.chunkGoals[step.key] = step.target;
        }
    };
    take(session.retryQueue); take(session.flowQueue);
    if (!session.active.length) {
        // Exhausted planned passes can leave misses. Keep retrying without introducing mastered fillers.
        session.active = session.order.filter(k => creditOf(session.facts[k]) < goalStage(session)).slice(0, session.options.chunkSize);
        session.chunkGoals = Object.fromEntries(session.active.map(k => [k, Math.min(goalStage(session), creditOf(session.facts[k]) + 1)]));
    }
    session.chunkTarget = Math.max(...Object.values(session.chunkGoals));
    session.roundRepair = session.active.every(k => session.chunkGoals[k] === 1);
}
export function roundDone(session, key) {
    return session.roundRepair ? creditOf(session.facts[key]) >= session.chunkGoals[key] : session.roundSeen.includes(key);
}
export function selectNext(value, deck, now = Date.now(), random = Math.random) {
    const session = clone(value), goal = goalStage(session);
    const pending = session.order.filter(k => sessionCredit(session, k) < goal);
    if (!pending.length && !session.options.practice) { session.completed = true; session.current = null; return session; }
    let key;
    if (session.options.practice) {
        if (!session.practiceQueue.length) session.practiceQueue = shuffled(session.order, random);
        if (session.practiceQueue[0] === session.lastKey && session.practiceQueue.length > 1) session.practiceQueue.push(session.practiceQueue.shift());
        key = session.practiceQueue.shift();
    } else {
        session.active = session.active.filter(k => session.order.includes(k));
        if (!session.active.length) planRound(session);
        const needsPractice = session.active.filter(k => !roundDone(session, k));
        if (!needsPractice.length) { session.checkpoint = true; session.current = null; return session; }
        if (writtenActivity(session)) key = needsPractice[0];
        else {
            let eligible = needsPractice.filter(k => session.ordinal - session.facts[k].lastOrdinal >= (session.facts[k].wrong ? 3 : 2));
            if (!eligible.length) eligible = needsPractice;
            const alternative = eligible.filter(k => k !== session.lastKey);
            if (alternative.length) eligible = alternative;
            eligible.sort((a, b) => Number(session.roundSeen.includes(a)) - Number(session.roundSeen.includes(b)) || session.active.indexOf(a) - session.active.indexOf(b));
            key = eligible[0];
        }
    }
    const item = session.scope.find(f => f.key === key), card = deck.cards.find(c => c.id === item.cardId), fact = session.facts[key];
    const types = session.options.types;
    let type = fact.stage >= 1 && types.includes('written') ? 'written' : types.includes('choice') ? 'choice' : types[0];
    if (writtenActivity(session)) type = session.options.activity === 'spell' ? 'spell' : 'written';
    const expected = answerFor(card, item.direction), accepted = new Set(answersFor(card, item.direction).map(answerKey)), binary = binaryOptions(expected);
    const candidates = new Map();
    for (const other of deck.cards) {
        const text = answerFor(other, item.direction), normalized = answerKey(text);
        // Same prompt or alias must never create a second plausibly correct option.
        if (other.id !== card.id && normalize(promptFor(other, item.direction)) !== normalize(promptFor(card, item.direction)) && !accepted.has(normalized) && normalized) candidates.set(normalized, text);
    }
    const distractors = shuffled([...candidates.values()], random).slice(0, 3);
    if (type === 'choice' && !distractors.length && !binary) type = types.includes('flash') ? 'flash' : 'written';
    if (type === 'truefalse' && !distractors.length) type = 'written';
    const related = deck.cards.filter(c => normalize(promptFor(c, item.direction)) === normalize(promptFor(card, item.direction)));
    const valid = new Map(related.flatMap(c => answersFor(c, item.direction)).map(a => [answerKey(a), a]));
    const correctAnswers = [...valid.values()].slice(0, 3);
    if (!writtenActivity(session) && fact.stage === 0 && types.includes('multi') && correctAnswers.length > 1) type = 'multi';
    let choices = [], statement = '', truth = true;
    // Quizlet presents Yes/No rather than long explanations for binary definitions.
    const choiceAnswer = type === 'choice' && binary ? binary.answer : expected;
    if (type === 'choice') choices = binary ? binary.choices : shuffled([expected, ...distractors], random);
    if (type === 'multi') choices = shuffled([...correctAnswers, ...distractors.filter(a => !valid.has(answerKey(a))).slice(0, Math.max(1, 5 - correctAnswers.length))], random);
    if (type === 'truefalse') { truth = random() > 0.5; statement = truth ? expected : distractors[0]; }
    session.current = { ...item, type, choices, choiceAnswer, statement, truth, correctAnswers: type === 'multi' ? correctAnswers : [] };
    session.feedback = null; session.updatedAt = now;
    return session;
}
export function submitAnswer(value, deck, response, now = Date.now(), judgement = null) {
    if (!value.current || value.feedback || value.checkpoint || value.completed) return value;
    const session = clone(value), q = session.current, card = deck.cards.find(c => c.id === q.cardId);
    const exact = q.type === 'choice' || q.type === 'spell';
    const accepted = q.type === 'choice' ? [q.choiceAnswer] : q.type === 'spell' ? [answerFor(card, q.direction)] : answersFor(card, q.direction);
    const correct = q.type === 'written' && judgement ? judgement.correct === true : q.type === 'multi' ? Array.isArray(response) && response.length === q.correctAnswers.length && q.correctAnswers.every(a => response.includes(a)) : q.type === 'flash' ? response === true : q.type === 'truefalse' ? response === q.truth : gradeAnswer(response, accepted, exact ? 'strict' : 'exact');
    const savedResponse = q.type === 'multi' ? JSON.stringify(response) : String(response);
    const before = clone(session.facts[q.key]);
    const beforeWriteCredit = session.writeCredits[q.key] || 0;
    session.ordinal++;
    session.facts[q.key] = { ...gradeFact(before, correct, now, session.ordinal), revision: card.revision };
    if (writtenActivity(session)) session.writeCredits[q.key] = Math.min(2, beforeWriteCredit + Number(correct));
    session.roundAnswers.push({ key: q.key, cardId: card.id, direction: q.direction, correct, response: savedResponse, type: q.type });
    if (session.options.practice) session.roundAnswers = session.roundAnswers.slice(-20);
    if ((session.options.activity !== 'spell' || correct) && !session.roundSeen.includes(q.key)) session.roundSeen.push(q.key);
    session.feedback = { correct, skipped: !correct && !savedResponse && ['written', 'spell'].includes(q.type), response: savedResponse, expected: answerFor(card, q.direction), before, beforeWriteCredit, answeredAt: now, retyped: !session.options.retype || correct || !['written', 'spell'].includes(q.type) };
    if (q.type === 'written' && judgement) {
        session.feedback.gradingStatus = judgement.status;
        session.feedback.gradingReason = judgement.reason;
    }
    if (q.type === 'written') session.feedback.requiresAcknowledgement = correct && savedResponse !== plainText(session.feedback.expected);
    session.lastKey = q.key; session.updatedAt = now;
    return session;
}
export function overrideCorrect(value, now = Date.now(), correct = true) {
    const session = clone(value);
    if (!session.feedback || session.feedback.correct === correct) return session;
    session.facts[session.current.key] = { ...gradeFact(session.feedback.before, correct, session.feedback.answeredAt ?? now, session.ordinal), revision: session.facts[session.current.key].revision };
    if (writtenActivity(session)) session.writeCredits[session.current.key] = Math.min(2, session.feedback.beforeWriteCredit + Number(correct));
    if (session.options.activity === 'spell') {
        session.roundSeen = session.roundSeen.filter(key => key !== session.current.key);
        if (correct) session.roundSeen.push(session.current.key);
    }
    session.feedback.correct = correct; session.feedback.retyped = correct || !session.options.retype;
    if (session.current.type === 'written') session.feedback.requiresAcknowledgement = correct && session.feedback.response !== plainText(session.feedback.expected);
    session.roundAnswers.at(-1).correct = correct; session.updatedAt = now;
    return session;
}
export function advanceSession(value, deck, now = Date.now(), random = Math.random) {
    if (!value.feedback || !value.feedback.retyped) return value;
    if (value.options.practice) {
        const session = clone(value);
        if (!session.feedback.correct && !session.practiceQueue.includes(session.current.key)) session.practiceQueue.splice(Math.min(2, session.practiceQueue.length), 0, session.current.key);
        session.feedback = null; session.current = null; session.updatedAt = now;
        return selectNext(session, deck, now, random);
    }
    const session = clone(value); session.feedback = null; session.current = null; session.updatedAt = now;
    if (session.order.every(k => sessionCredit(session, k) >= goalStage(session))) { session.completed = true; return session; }
    if (session.active.every(k => roundDone(session, k))) {
        if (session.options.activity === 'spell') { session.round++; session.active = []; return selectNext(session, deck, now, random); }
        session.checkpoint = true; return session;
    }
    return selectNext(session, deck, now, random);
}
export function continueRound(value, deck, now = Date.now(), random = Math.random) {
    const session = clone(value); session.round++; session.roundAnswers = []; session.checkpoint = false;
    if (writtenActivity(session)) session.passMisses = [...new Set(value.roundAnswers.filter(answer => !answer.correct).map(answer => answer.key))];
    for (const key of session.active) {
        if (!writtenActivity(session) && creditOf(session.facts[key]) < session.chunkGoals[key] && !session.retryQueue.some(step => step.key === key)) session.retryQueue.push({ key, target: session.chunkGoals[key] });
    }
    session.active = [];
    return selectNext(session, deck, now, random);
}
export function sessionProgress(session) {
    const stages = session.order.map(k => writtenActivity(session) ? sessionCredit(session, k) : session.facts[k].stage), goal = goalStage(session);
    const earned = session.order.reduce((n, k) => n + Math.min(goal, sessionCredit(session, k)), 0);
    // Feedback is shown before the progress marker advances to the next question.
    const displayedEarned = session.feedback ? earned - Math.min(goal, sessionCredit(session, session.current.key)) + Math.min(goal, writtenActivity(session) ? session.feedback.beforeWriteCredit : creditOf(session.feedback.before)) : earned;
    return { earned, displayedEarned, total: stages.length, new: stages.filter(s => !s).length, learning: stages.filter(s => s === 1).length, mastered: stages.filter(s => s === 2).length,
        completed: session.order.filter(k => sessionCredit(session, k) >= goal).length, percent: Math.round(earned / (stages.length * goal) * 100) };
}
