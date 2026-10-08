import { answerKey, plainText, expandParentheses } from './model.js';
import { gradingLevel } from './grading-options.js';
import { inferEquivalence } from './equivalence-client.js';
import { terminologyComparison } from './terminology.js';

// NLI scores are evidence, not calibrated probabilities of answer correctness.
export const GRADING_THRESHOLDS = {
    relaxed: { entailment: 0.80, contradiction: 0.12 },
    standard: { entailment: 0.90, contradiction: 0.06 },
    rigorous: { entailment: 0.97, contradiction: 0.02 }
};
export const exactKey = value => answerKey(value).replace(/\s/gu, '');
const words = value => plainText(value).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const oppositions = [
    ['positive', 'negative'], ['increase', 'decrease'], ['increased', 'decreased'],
    ['left', 'right'], ['proximal', 'distal'], ['afferent', 'efferent'],
    ['agonist', 'antagonist'], ['benign', 'malignant'], ['acute', 'chronic'],
    ['dominant', 'recessive'], ['inhibition', 'activation'], ['hyperplasia', 'hypertrophy'],
    ['ileum', 'ilium'], ['陽性', '陰性'], ['增加', '減少'], ['升高', '降低'],
    ['左', '右'], ['良性', '惡性'], ['急性', '慢性'], ['顯性', '隱性'], ['抑制', '活化']
];
const sorted = list => [...list].sort().join('|');

export function criticalConflict(reference, candidate) {
    const r = plainText(reference).normalize('NFKC').toLowerCase();
    const c = plainText(candidate).normalize('NFKC').toLowerCase();
    const rw = words(r), cw = words(c);
    const numbers = text => text.match(/(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/g) || [];
    if (sorted(numbers(r)) !== sorted(numbers(c))) return 'number';
    // Preserve scientific operators, charge, decimal points, ratios and units.
    const signs = text => text.match(/[+\-−±=<>≤≥×÷/^]|(?<=\d):(?=\d)/g) || [];
    const signText = text => text.replace(/(?<=\p{L})-(?=\p{L})/gu, ' ');
    if (sorted(signs(signText(r))) !== sorted(signs(signText(c)))) return 'symbol';
    const units = text => [...text.matchAll(/\d\s*(μg|µg|ug|mg|kg|g|ml|μl|µl|ul|l|mmol|mol|cm|mm|km|m|ms|s|hz|khz|mhz|pa|kpa|mmhg|%)(?![a-z])/g)].map(m => m[1].replace(/[μµ]/g, 'u'));
    if (sorted(units(r)) !== sorted(units(c))) return 'unit';
    const quantities = text => [...text.matchAll(/((?:\d+(?:\.\d+)?|\.\d+))\s*(μg|µg|ug|mg|kg|g|ml|μl|µl|ul|l|mmol|mol|cm|mm|km|m|ms|s|hz|khz|mhz|pa|kpa|mmhg|%)(?![a-z])/g)].map(m => `${m[1]}:${m[2].replace(/[μµ]/g, 'u')}`);
    if (sorted(quantities(r)) !== sorted(quantities(c))) return 'quantity';
    const charges = text => [...text.matchAll(/\b(na|k|ca|cl|mg|cd\d+|ig[a-z])\s*([+−-])/g)].map(m => m[0].replace(/\s/g, ''));
    if (sorted(charges(r)) !== sorted(charges(c))) return 'charge';
    // Embedded multiplication must not disappear as apparent Markdown emphasis.
    const multiplication = text => String(text).match(/(?<=[\p{L}\p{N}])\*(?=[\p{L}\p{N}])/gu) || [];
    if (multiplication(reference).length !== multiplication(candidate).length) return 'symbol';
    const has = (text, tokens, word) => /[\u3400-\u9fff]/.test(word) ? text.includes(word) : tokens.includes(word);
    for (const [a, b] of oppositions) {
        if (has(r, rw, a) && has(c, cw, b) && !has(r, rw, b) || has(r, rw, b) && has(c, cw, a) && !has(r, rw, a)) return 'opposition';
    }
    if (rw.some(a => cw.some(b => /^(hyper|hypo)/.test(a) && /^(hyper|hypo)/.test(b) && a.replace(/^(hyper|hypo)/, '') === b.replace(/^(hyper|hypo)/, '') && a !== b))) return 'polarity';
    const negated = (text, tokens) => tokens.some(w => ['no', 'not', 'never', 'without', 'absent', 'non'].includes(w)) || /不|無|沒有|未/.test(text);
    if (negated(r, rw) !== negated(c, cw)) return 'negation';
    const entities = tokens => tokens.filter(w => /^(?:na|k|ca|cl|mg|igg|igm|iga|ige|igd)$/.test(w) || /^(?:cd|ig|t)\d+$/.test(w));
    if (entities(rw).length && entities(cw).length && sorted(entities(rw)) !== sorted(entities(cw))) return 'entity';
    return null;
}

export function lexicalFeatures(reference, candidate) {
    const strip = text => exactKey(text).normalize('NFD').replace(/\p{M}/gu, '');
    const stem = text => words(text).map(w => w.replace(/(?:ations?|ions?|ies|es|s)$/u, '')).join(' ');
    return { accentOnly: strip(reference) === strip(candidate), relatedMorphology: stem(reference) === stem(candidate) };
}

const verdict = (status, reason, extra = {}) => ({ status, correct: status === 'correct', reason, ...extra });

export async function gradeEquivalence({ prompt = '', expected, aliases = [], response, grading = 'standard', onProgress, signal }, infer = inferEquivalence, terminology = terminologyComparison) {
    const wait = promise => {
        if (!signal) return promise;
        signal.throwIfAborted();
        let abort;
        const cancelled = new Promise((_, reject) => { abort = () => reject(new Error('Cancelled')); signal.addEventListener('abort', abort, { once: true }); });
        return Promise.race([promise, cancelled]).finally(() => signal.removeEventListener('abort', abort));
    };
    const level = gradingLevel(grading);
    if (!String(response ?? '').trim()) return verdict('incorrect', 'empty');
    const responseKey = exactKey(response);
    if (!responseKey) return verdict('incorrect', 'empty');
    const accepted = [...new Set([expected, ...aliases].filter(a => typeof a === 'string' && a.trim()))];
    if (accepted.some(a => exactKey(a) === responseKey && !criticalConflict(a, response))) return verdict('correct', 'exact');
    if (level === 'exact') return verdict('incorrect', 'exact-mismatch');

    const expandedVariants = accepted.flatMap(a => expandParentheses(a));
    const inputVariants = expandParentheses(response);
    if (!criticalConflict(expected, response) && inputVariants.some(inp => {
        const inpKey = exactKey(inp);
        return inpKey && expandedVariants.some(exp => exactKey(exp) === inpKey && !criticalConflict(exp, inp));
    })) return verdict('correct', 'exact');

    const safe = accepted.filter(a => !criticalConflict(a, response));
    if (!safe.length) return verdict('incorrect', 'critical-conflict');
    const threshold = GRADING_THRESHOLDS[level];
    let best = null, uncertain = safe.length > 16;
    try {
        for (const reference of safe.slice(0, 16)) {
            let concept = null;
            // Failure to load the public index must not disable local model inference.
            onProgress?.({ status: 'terminology' });
            try { concept = await wait(terminology(reference, response)); } catch {}
            if (signal?.aborted) return verdict('uncertain', 'cancelled');
            if (concept === 'same') return verdict('correct', 'same-concept');
            if (concept === 'different') continue;
            const features = lexicalFeatures(reference, response);
            // Morphology and spelling similarity never independently award credit.
            const result = await wait(infer({ prompt: plainText(prompt), reference: plainText(reference), candidate: plainText(response), features }, onProgress));
            if (result.uncertainReason) { uncertain = true; continue; }
            const { forward, backward } = result;
            const scores = [forward?.entailment, backward?.entailment, forward?.contradiction, backward?.contradiction];
            if (!scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid inference scores');
            const entailment = Math.min(forward.entailment, backward.entailment);
            const contradiction = Math.max(forward.contradiction, backward.contradiction);
            if (!best || entailment > best.entailment) best = { entailment, contradiction };
            if (entailment >= threshold.entailment && contradiction <= threshold.contradiction) return verdict('correct', 'semantic-equivalent', { entailment, contradiction });
            // Neutral can mean an unfamiliar abbreviation or term, not a proven mismatch.
            if (contradiction < 0.5) uncertain = true;
        }
    } catch {
        return verdict('uncertain', signal?.aborted ? 'cancelled' : 'model-unavailable');
    }
    return verdict(uncertain ? 'uncertain' : 'incorrect', uncertain ? 'ambiguous' : 'semantic-mismatch', best || {});
}
