// Independent vocabulary sets. Quizlet's undisclosed coefficients are not used.
export const MAX_CARDS = 2000;
export const DEFAULT_OPTIONS = { direction: 'term', scope: 'all', shuffle: false, goal: 'master', types: ['choice', 'multi', 'written'], grading: 'strict', retype: false, audio: false, sound: true, chunkSize: 7, familiarity: 'new' };
export const id = () => crypto.randomUUID();
export const clone = value => JSON.parse(JSON.stringify(value));
export const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
export const plainText = value => String(value ?? '').replace(/\*\*(.+?)\*\*|__(.+?)__|==(.+?)==|\*([^*]+?)\*/gs, (_, a, b, c, d) => a || b || c || d);
export function answerKey(value) {
    // Keep medical/math operators, units, decimal points and digits significant.
    return normalize(plainText(value)).replace(/[，,。!?！？“”"'‘’]/g, '').replace(/[.;；]$/g, '').trim();
}
export function gradeAnswer(input, answers, grading = 'strict') {
    const key = answerKey(input);
    if (!key) return false;
    return answers.some(answer => {
        const expected = answerKey(answer);
        if (key === expected) return true;
        if (grading !== 'moderate' || /[\d+−=<>/]/.test(expected) || expected.length < 5 || /[^a-zÀ-ž\s-]/i.test(expected)) return false;
        const strip = s => s.normalize('NFD').replace(/\p{M}/gu, '');
        const a = strip(key), b = strip(expected);
        if (a === b) return true;
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
}
function delimiters(options) {
    const decode = s => (s || '').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    const term = decode(options.term === 'tab' ? '\t' : options.term === 'comma' ? ',' : options.term === 'dash' ? '-' : options.termCustom);
    const row = decode(options.row === 'newline' ? '\n' : options.row === 'semicolon' ? ';' : options.rowCustom);
    if (!term || !row || term === row || term.length > 20 || row.length > 20) throw new Error('請設定不同且非空的分隔符號（最多 20 字元）。');
    return { term, row };
}
export function parseImport(text, options = { term: 'tab', row: 'newline' }) {
    const { term, row } = delimiters(options);
    const input = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (input.length > 4000000) throw new Error('匯入文字超過 4 MB，請分批匯入。');
    // Delimiter based, matching Quizlet's paste tool: only the first term delimiter splits a row.
    const cards = [], errors = [];
    for (const [i, line] of input.split(row).entries()) {
        if (!line.trim()) continue;
        const cut = line.indexOf(term);
        const a = cut < 0 ? line.trim() : line.slice(0, cut).trim(), b = cut < 0 ? '' : line.slice(cut + term.length).trim();
        cards.push({ term: a, definition: b });
        if (!a || !b) errors.push({ row: i + 1, message: cut < 0 ? '找不到單字與解釋的分隔符號' : '單字或解釋為空白' });
        if (a.length > 4000 || b.length > 4000) errors.push({ row: i + 1, message: '單面最多 4000 字元' });
        if (cards.length > MAX_CARDS) throw new Error(`每組最多 ${MAX_CARDS} 張字卡。`);
    }
    const seen = new Set(); let duplicates = 0;
    for (const c of cards) { const key = normalize(c.term) + '\u0000' + normalize(c.definition); if (seen.has(key)) duplicates++; seen.add(key); }
    return { cards, errors, duplicates };
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
    return { id: previous?.id || draft.id || id(), title: draft.title.trim(), description: (draft.description || '').slice(0, 2000), termLanguage: draft.termLanguage || 'en-US', definitionLanguage: draft.definitionLanguage || 'zh-TW', cards,
        revision: (previous?.revision || 0) + 1, createdAt: previous?.createdAt || now, updatedAt: now };
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
export function hydrateSession(value) {
    const s = clone(value);
    s.order = Object.values(s.order || {});
    if (s.mode === 'flash') s.ratings ||= {};
    else { s.active = Object.values(s.active || {}); s.scope = Object.values(s.scope || {}); s.roundAnswers = Object.values(s.roundAnswers || {}); s.options.types = Object.values(s.options.types || {}); }
    return s;
}
export function freshFact() { return { stage: 0, correct: 0, wrong: 0, streak: 0, lastAt: 0, interval: 0, dueAt: 0, lastOrdinal: -10 }; }
export function gradeFact(fact, correct, now, ordinal = 0) {
    const value = { ...freshFact(), ...fact };
    const stage = correct ? Math.min(2, value.stage + 1) : 0;
    const interval = correct && stage === 2 ? Math.min(90, Math.max(1, value.interval * 2, (now - (value.lastAt || now)) / 86400000 * 2)) : 0;
    return { stage, correct: value.correct + Number(correct), wrong: value.wrong + Number(!correct), streak: correct ? value.streak + 1 : 0,
        lastAt: now, interval, dueAt: now + interval * 86400000, lastOrdinal: ordinal };
}
// Chronological event replay gives the same aggregates after offline retries or concurrent devices.
export function projectStudy(study = {}) {
    const events = Object.values(study.events || {}).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const overrides = new Map(events.filter(e => e.kind === 'override').map(e => [e.originalId, e]));
    const reset = events.filter(e => e.kind === 'reset').at(-1);
    const generation = reset?.generation || 'initial', facts = {}, flash = {}, stars = {};
    let correct = 0, wrong = 0;
    for (const e of events) {
        if (e.kind === 'star') { stars[e.cardId] = e.value; continue; }
        if (e.kind === 'flash') { flash[factKey(e.cardId, e.direction)] = { known: e.correct, revision: e.revision, at: e.at }; continue; }
        if (e.kind !== 'answer' || (e.generation || 'initial') !== generation) continue;
        const key = factKey(e.cardId, e.direction), old = facts[key];
        if (old?.revision > e.revision) continue;
        const base = old?.revision === e.revision ? old : { ...freshFact(), stage: e.initialStage === 1 ? 1 : 0 };
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
    const known = projected.flash[key]?.revision === card.revision && projected.flash[key]?.known;
    return { ...freshFact(), stage: known || options.familiarity === 'familiar' ? 1 : 0, revision: card.revision };
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
    const options = { ...DEFAULT_OPTIONS, ...input };
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
            facts[key] = options.scope === 'due' ? { ...fact, stage: 1 } : fact;
            scope.push({ key, cardId: card.id, direction });
        }
    }
    if (!scope.length) throw new Error('這個範圍沒有可練習的字卡。');
    const order = options.shuffle ? shuffled(scope.map(f => f.key), random) : scope.map(f => f.key);
    const session = { id: id(), mode: 'learn', deckId: deck.id, deckRevision: deck.revision, generation: projected.generation, options, scope, order, facts, active: [], chunk: 0, chunkTarget: 1, chunkGoals: {},
        ordinal: 0, round: 1, roundAnswers: [], lastKey: '', current: null, feedback: null, checkpoint: false, completed: false, createdAt: now, updatedAt: now };
    return selectNext(session, deck, now, random);
}
function priority(fact, now) {
    // Lower recall is scheduled sooner. These transparent weights are Teah's, not Quizlet's.
    const elapsed = Math.max(0, now - fact.lastAt) / 86400000;
    const stability = Math.max(1, fact.interval || 1);
    const recall = fact.stage === 0 ? 0 : Math.exp(-elapsed / stability) * (fact.stage === 1 ? 0.55 : 0.9);
    return recall - Math.min(0.25, fact.wrong * 0.05);
}
const goalStage = session => session.options.goal === 'quick' ? 1 : 2;
export function selectNext(value, deck, now = Date.now(), random = Math.random) {
    const session = clone(value), goal = goalStage(session);
    const pending = session.order.filter(k => session.facts[k].stage < goal);
    if (!pending.length) { session.completed = true; session.current = null; return session; }
    // Retain completed group members for a stable seven-term checkpoint and progress denominator.
    session.active = session.active.filter(k => session.order.includes(k));
    if (!session.active.length) {
        session.chunk++;
        // Keep the same small group until learned; do not introduce hundreds of fresh terms during repairs.
        session.active = pending.sort((a, b) => session.facts[a].stage - session.facts[b].stage || priority(session.facts[a], now) - priority(session.facts[b], now) || session.order.indexOf(a) - session.order.indexOf(b)).slice(0, session.options.chunkSize);
        session.chunkGoals = Object.fromEntries(session.active.map(k => [k, Math.min(goal, session.facts[k].stage + 1)]));
        session.chunkTarget = Math.max(...Object.values(session.chunkGoals));
    }
    const needsPractice = session.active.filter(k => session.facts[k].stage < (session.chunkGoals?.[k] || session.chunkTarget));
    if (!needsPractice.length) { session.checkpoint = true; session.current = null; return session; }
    let eligible = needsPractice.filter(k => session.ordinal - session.facts[k].lastOrdinal >= (session.facts[k].wrong ? 3 : 2));
    if (!eligible.length) eligible = needsPractice;
    const alternative = eligible.filter(k => k !== session.lastKey);
    if (alternative.length) eligible = alternative;
    eligible.sort((a, b) => session.facts[a].lastOrdinal - session.facts[b].lastOrdinal || priority(session.facts[a], now) - priority(session.facts[b], now) || session.order.indexOf(a) - session.order.indexOf(b));
    const key = eligible[0], item = session.scope.find(f => f.key === key), card = deck.cards.find(c => c.id === item.cardId), fact = session.facts[key];
    const types = session.options.types;
    let type = fact.stage >= 1 && types.includes('written') ? 'written' : types.includes('choice') ? 'choice' : types[0];
    const expected = answerFor(card, item.direction), accepted = new Set(answersFor(card, item.direction).map(answerKey));
    const candidates = new Map();
    for (const other of deck.cards) {
        const text = answerFor(other, item.direction), normalized = answerKey(text);
        // Same prompt or alias must never create a second plausibly correct option.
        if (other.id !== card.id && normalize(promptFor(other, item.direction)) !== normalize(promptFor(card, item.direction)) && !accepted.has(normalized) && normalized) candidates.set(normalized, text);
    }
    const distractors = shuffled([...candidates.values()], random).slice(0, 3);
    if (type === 'choice' && !distractors.length) type = types.includes('flash') ? 'flash' : 'written';
    if (type === 'truefalse' && !distractors.length) type = 'written';
    const related = deck.cards.filter(c => normalize(promptFor(c, item.direction)) === normalize(promptFor(card, item.direction)));
    const valid = new Map(related.flatMap(c => answersFor(c, item.direction)).map(a => [answerKey(a), a]));
    const correctAnswers = [...valid.values()].slice(0, 3);
    if (fact.stage === 0 && types.includes('multi') && correctAnswers.length > 1) type = 'multi';
    let choices = [], statement = '', truth = true;
    if (type === 'choice') choices = shuffled([expected, ...distractors], random);
    if (type === 'multi') choices = shuffled([...correctAnswers, ...distractors.filter(a => !valid.has(answerKey(a))).slice(0, Math.max(1, 5 - correctAnswers.length))], random);
    if (type === 'truefalse') { truth = random() > 0.5; statement = truth ? expected : distractors[0]; }
    session.current = { ...item, type, choices, statement, truth, correctAnswers: type === 'multi' ? correctAnswers : [] };
    session.feedback = null; session.updatedAt = now;
    return session;
}
export function submitAnswer(value, deck, response, now = Date.now()) {
    if (!value.current || value.feedback || value.checkpoint || value.completed) return value;
    const session = clone(value), q = session.current, card = deck.cards.find(c => c.id === q.cardId);
    const correct = q.type === 'multi' ? Array.isArray(response) && response.length === q.correctAnswers.length && q.correctAnswers.every(a => response.includes(a)) : q.type === 'flash' ? response === true : q.type === 'truefalse' ? response === q.truth : gradeAnswer(response, answersFor(card, q.direction), session.options.grading);
    const savedResponse = q.type === 'multi' ? JSON.stringify(response) : String(response);
    const before = clone(session.facts[q.key]);
    session.ordinal++;
    session.facts[q.key] = { ...gradeFact(before, correct, now, session.ordinal), revision: card.revision };
    session.roundAnswers.push({ key: q.key, cardId: card.id, direction: q.direction, correct, response: savedResponse, type: q.type });
    session.feedback = { correct, response: savedResponse, expected: answerFor(card, q.direction), before, retyped: !session.options.retype || correct || !['written', 'spell'].includes(q.type) };
    session.lastKey = q.key; session.updatedAt = now;
    return session;
}
export function overrideCorrect(value, now = Date.now()) {
    const session = clone(value);
    if (!session.feedback || session.feedback.correct) return session;
    session.facts[session.current.key] = { ...gradeFact(session.feedback.before, true, now, session.ordinal), revision: session.facts[session.current.key].revision };
    session.feedback.correct = true; session.feedback.retyped = true;
    session.roundAnswers.at(-1).correct = true; session.updatedAt = now;
    return session;
}
export function advanceSession(value, deck, now = Date.now(), random = Math.random) {
    if (!value.feedback || !value.feedback.retyped) return value;
    const session = clone(value); session.feedback = null; session.current = null; session.updatedAt = now;
    if (session.order.every(k => session.facts[k].stage >= goalStage(session))) { session.completed = true; return session; }
    if (session.active.every(k => session.facts[k].stage >= (session.chunkGoals?.[k] || session.chunkTarget))) { session.checkpoint = true; return session; }
    return selectNext(session, deck, now, random);
}
export function continueRound(value, deck, now = Date.now(), random = Math.random) {
    const session = clone(value); session.round++; session.roundAnswers = []; session.checkpoint = false;
    session.active = [];
    return selectNext(session, deck, now, random);
}
export function sessionProgress(session) {
    const stages = session.order.map(k => session.facts[k].stage), goal = goalStage(session);
    return { total: stages.length, new: stages.filter(s => !s).length, learning: stages.filter(s => s === 1).length, mastered: stages.filter(s => s === 2).length,
        completed: stages.filter(s => s >= goal).length, percent: Math.round(stages.reduce((n, s) => n + Math.min(goal, s), 0) / (stages.length * goal) * 100) };
}
