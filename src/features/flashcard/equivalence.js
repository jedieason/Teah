import { answerKey, plainText, expandParentheses, criticalConflict, approximateMatch, exactKey, isPunctuationOrPluralMatch } from './model.js';
import { gradingLevel } from './grading-options.js';
import { inferEquivalence } from './equivalence-client.js';
import { terminologyComparison } from './terminology.js';

export { criticalConflict, exactKey };

// NLI scores are evidence, not calibrated probabilities of answer correctness.
export const GRADING_THRESHOLDS = {
    relaxed: { entailment: 0.80, contradiction: 0.12 },
    standard: { entailment: 0.90, contradiction: 0.06 },
    rigorous: { entailment: 0.97, contradiction: 0.02 }
};

const words = value => plainText(value).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

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
    if (signal?.aborted) return verdict('uncertain', 'cancelled');
    const level = gradingLevel(grading);
    if (!String(response ?? '').trim()) return verdict('incorrect', 'empty');
    const responseKey = exactKey(response);
    if (!responseKey) return verdict('incorrect', 'empty');
    const accepted = [...new Set([expected, ...aliases].filter(a => typeof a === 'string' && a.trim()))];
    if (accepted.some(a => exactKey(a) === responseKey && !criticalConflict(a, response))) return verdict('correct', 'exact');
    if (level === 'exact') return verdict('incorrect', 'exact-mismatch');

    const expandedVariants = accepted.flatMap(a => expandParentheses(a));
    const inputVariants = expandParentheses(response);
    const hasConflict = criticalConflict(expected, response);

    if (!hasConflict) {
        for (const inp of inputVariants) {
            const inpKey = exactKey(inp);
            if (!inpKey) continue;
            for (const exp of expandedVariants) {
                if (exactKey(exp) === inpKey && !criticalConflict(exp, inp)) {
                    const hasDiff = plainText(response).trim() !== plainText(exp).trim();
                    return verdict('correct', 'exact', { discrepancy: hasDiff, bestExpected: exp });
                }
            }
        }
    }

    const safe = accepted.filter(a => !criticalConflict(a, response));
    if (!safe.length) return verdict('incorrect', 'critical-conflict');
    const threshold = GRADING_THRESHOLDS[level] || GRADING_THRESHOLDS.standard;
    let best = null, uncertain = safe.length > 16;
    try {
        for (const reference of safe.slice(0, 16)) {
            let concept = null;
            // Failure to load the public index must not disable local model inference.
            onProgress?.({ status: 'terminology' });
            try { concept = await wait(terminology(reference, response)); } catch {}
            if (signal?.aborted) return verdict('uncertain', 'cancelled');
            if (concept === 'same') return verdict('correct', 'same-concept', { discrepancy: plainText(response).trim() !== plainText(reference).trim(), bestExpected: reference });
            if (concept === 'different') continue;

            if (!hasConflict && (level === 'relaxed' || level === 'standard')) {
                for (const exp of expandedVariants) {
                    for (const inp of inputVariants) {
                        const approx = approximateMatch(exp, inp, level);
                        if (approx && approx.match) {
                            return verdict('correct', approx.reason, { discrepancy: true, bestExpected: exp });
                        }
                    }
                }
            }

            const features = lexicalFeatures(reference, response);
            const result = await wait(infer({ prompt: plainText(prompt), reference: plainText(reference), candidate: plainText(response), features }, onProgress));
            if (result.uncertainReason) { uncertain = true; continue; }
            const { forward, backward } = result;
            const scores = [forward?.entailment, backward?.entailment, forward?.contradiction, backward?.contradiction];
            if (!scores.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid inference scores');
            const entailment = Math.min(forward.entailment, backward.entailment);
            const contradiction = Math.max(forward.contradiction, backward.contradiction);
            if (!best || entailment > best.entailment) best = { entailment, contradiction };
            if (entailment >= threshold.entailment && contradiction <= threshold.contradiction) {
                return verdict('correct', 'semantic-equivalent', { entailment, contradiction, discrepancy: plainText(response).trim() !== plainText(reference).trim(), bestExpected: reference });
            }
            if (contradiction < 0.5) uncertain = true;
        }
    } catch {
        return verdict('uncertain', signal?.aborted ? 'cancelled' : 'model-unavailable');
    }
    return verdict(uncertain ? 'uncertain' : 'incorrect', uncertain ? 'ambiguous' : 'semantic-mismatch', best || {});
}
