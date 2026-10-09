/**
 * Exam Deduplication & Past-Paper Repetition Detection Service
 * Detects questions that appeared repeatedly in subsequent exam cohorts (e.g. B08 repeated in B09, B10, etc.)
 */

export function parseQuizYear(key) {
    if (!key) return null;
    const clean = key.replace(/^_Archive_/, '');
    const idx = clean.indexOf('｜');
    const subject = idx !== -1 ? clean.slice(0, idx) : '其他';
    const title = idx !== -1 ? clean.slice(idx + 1) : clean;
    const match = title.match(/B(\d+)/i);
    if (!match) return null;
    const yearNum = parseInt(match[1], 10);
    const yearStr = match[0].toUpperCase();
    const subType = title.replace(new RegExp(match[0], 'i'), '').trim();
    return { subject, title, yearNum, yearStr, subType };
}

export function findSubsequentQuizzes(targetKey, allKeys = []) {
    const target = parseQuizYear(targetKey);
    if (!target) return [];

    return allKeys.filter(k => {
        const info = parseQuizYear(k);
        if (!info) return false;
        if (info.subject !== target.subject) return false;
        if (info.yearNum <= target.yearNum) return false;

        // Subtype matching (e.g., 期中 matches 期中/期中考; 期末 matches 期末; 考古 matches 考古 or empty)
        const tSub = target.subType;
        const iSub = info.subType;

        if (tSub.includes('期中')) return iSub.includes('期中');
        if (tSub.includes('期末')) return iSub.includes('期末');
        if (tSub.includes('考古')) return iSub.includes('考古') || !iSub;
        if (!tSub) return !iSub || iSub.includes('考古');

        return tSub === iSub;
    }).sort((a, b) => {
        const ia = parseQuizYear(a);
        const ib = parseQuizYear(b);
        return ia.yearNum - ib.yearNum;
    });
}

export function normalizeText(text) {
    if (!text) return '';
    return String(text)
        .toLowerCase()
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[\$\\]/g, '') // remove LaTeX math markers
        .replace(/[，。？！、；：""\x27\x22（）\(\)\[\]【】《》〈〉]/g, '')
        .replace(/[,\.?!;:\x27\(\)\[\]\-_]/g, '')
        .replace(/\s+/g, '');
}

export function getBigrams(str) {
    const s = normalizeText(str);
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
}

export function diceSimilarity(str1, str2) {
    const n1 = normalizeText(str1);
    const n2 = normalizeText(str2);
    if (!n1 || !n2) return 0.0;
    if (n1 === n2) return 1.0;
    if (n1.length > 8 && n2.length > 8) {
        if (n1.includes(n2) || n2.includes(n1)) {
            return Math.max(0.85, Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length));
        }
    }
    const b1 = getBigrams(str1);
    const b2 = getBigrams(str2);
    if (b1.size === 0 || b2.size === 0) return 0.0;
    let matches = 0;
    for (const bg of b1) {
        if (b2.has(bg)) matches++;
    }
    return (2 * matches) / (b1.size + b2.size);
}

export function isGenericStem(text) {
    const norm = normalizeText(text);
    if (norm.length <= 15 && /^(下列|何者|何項|何種|關於|有關).*(正確|錯誤|不正確|為是|為非)$/.test(norm)) {
        return true;
    }
    return false;
}

export function optionsSimilarity(opt1, opt2) {
    if (!opt1 || !opt2) return null;
    const vals1 = Object.values(opt1).map(normalizeText).filter(Boolean);
    const vals2 = Object.values(opt2).map(normalizeText).filter(Boolean);
    if (vals1.length === 0 || vals2.length === 0) return null;

    let matches = 0;
    for (const v1 of vals1) {
        if (vals2.some(v2 => v1 === v2 || diceSimilarity(v1, v2) >= 0.75)) {
            matches++;
        }
    }
    return (2 * matches) / (vals1.length + vals2.length);
}

export function areQuestionsDuplicate(q1, q2, threshold = 0.70) {
    if (!q1 || !q2) return false;
    const qSim = diceSimilarity(q1.question, q2.question);
    const hasOpt1 = q1.options && typeof q1.options === 'object' && Object.keys(q1.options).length > 0;
    const hasOpt2 = q2.options && typeof q2.options === 'object' && Object.keys(q2.options).length > 0;

    if (hasOpt1 && hasOpt2) {
        const optSim = optionsSimilarity(q1.options, q2.options);
        const generic = isGenericStem(q1.question) || isGenericStem(q2.question);

        // Generic stems must have matching options
        if (generic) {
            return optSim !== null && optSim >= 0.6;
        }

        // Virtually identical stems
        if (qSim >= 0.95) {
            return optSim === null || optSim >= 0.35;
        }

        const combined = 0.65 * qSim + 0.35 * (optSim || 0);
        return combined >= threshold || (qSim >= 0.75 && (optSim || 0) >= 0.5);
    }

    // Stem similarity for non-multiple-choice or mismatched formats
    if (qSim >= threshold) return true;

    // Check answer / explanation similarity for fill-in-blank / essay
    const a1 = Array.isArray(q1.answer) ? q1.answer.join(' ') : String(q1.answer || '');
    const a2 = Array.isArray(q2.answer) ? q2.answer.join(' ') : String(q2.answer || '');
    if (a1 && a2 && a1.length > 5 && a2.length > 5) {
        const aSim = diceSimilarity(a1, a2);
        if (0.5 * qSim + 0.5 * aSim >= threshold) return true;
    }

    return false;
}

export function filterNonRepeatedQuestions(currentQuestions, laterQuestionBanks, threshold = 0.70) {
    if (!Array.isArray(currentQuestions)) return { nonRepeated: [], repeated: [], duplicates: [] };
    if (!Array.isArray(laterQuestionBanks) || laterQuestionBanks.length === 0) {
        return {
            nonRepeated: [...currentQuestions],
            repeated: [],
            duplicates: []
        };
    }

    const pool = [];
    laterQuestionBanks.forEach(bank => {
        const questions = bank.questions || [];
        const bankKey = bank.key || '';
        const yearInfo = parseQuizYear(bankKey);
        const yearLabel = yearInfo ? yearInfo.yearStr : bankKey;
        questions.forEach((q, idx) => {
            pool.push({ q, bankKey, yearLabel, index: idx });
        });
    });

    const nonRepeated = [];
    const repeated = [];
    const duplicates = [];

    currentQuestions.forEach((q, idx) => {
        let isDuplicate = false;
        let matchedItem = null;

        for (const item of pool) {
            if (areQuestionsDuplicate(q, item.q, threshold)) {
                isDuplicate = true;
                matchedItem = item;
                break;
            }
        }

        if (isDuplicate) {
            repeated.push(q);
            duplicates.push({
                questionIndex: idx,
                question: q,
                matchedIn: matchedItem.yearLabel,
                matchedBankKey: matchedItem.bankKey
            });
        } else {
            nonRepeated.push(q);
        }
    });

    return { nonRepeated, repeated, duplicates };
}

export async function getPastExamComparisonInfo(targetKey, allCatalogKeys, readBankFn) {
    const targetInfo = parseQuizYear(targetKey);
    if (!targetInfo) {
        return { hasLaterExams: false };
    }

    const laterKeys = findSubsequentQuizzes(targetKey, allCatalogKeys);
    if (!laterKeys || laterKeys.length === 0) {
        return { hasLaterExams: false, targetInfo };
    }

    const maxLaterInfo = parseQuizYear(laterKeys[laterKeys.length - 1]);
    const rangeStr = `${targetInfo.yearStr} - ${maxLaterInfo.yearStr}`;

    const currentQuestions = await readBankFn(targetKey);

    const laterBanks = await Promise.all(
        laterKeys.map(async key => {
            try {
                const rows = await readBankFn(key);
                return { key, questions: rows || [] };
            } catch (err) {
                console.warn(`Failed to read bank for comparison: ${key}`, err);
                return { key, questions: [] };
            }
        })
    );

    const { nonRepeated, repeated, duplicates } = filterNonRepeatedQuestions(currentQuestions, laterBanks);

    return {
        hasLaterExams: true,
        targetInfo,
        laterKeys,
        rangeStr,
        totalCount: currentQuestions.length,
        nonRepeatedCount: nonRepeated.length,
        repeatedCount: repeated.length,
        nonRepeatedQuestions: nonRepeated,
        repeatedQuestions: repeated,
        duplicates
    };
}
