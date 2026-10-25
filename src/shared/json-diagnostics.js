// Utilities for diagnosing, auto-repairing, and merging incomplete/malformed quiz JSON.

export function stripMarkdownFences(text) {
    if (typeof text !== 'string') return '';
    let s = text.trim();
    // Strip leading ```json, ```JSON, ```, '''json, '''
    s = s.replace(/^(?:```|''')(?:json)?\s*\n?/i, '');
    // Strip trailing ``` or '''
    s = s.replace(/\n?\s*(?:```|''')$/, '');
    return s.trim();
}

export function getLineColFromPosition(text, position) {
    const clamped = Math.max(0, Math.min(position, text.length));
    const lines = text.slice(0, clamped).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    return { line, col };
}

export function scanJson(text) {
    let inString = false;
    let escaped = false;
    const stack = []; // { char: '{' | '[', index, line, col, unexpected?: boolean }
    let line = 1;
    let col = 0;
    let lastNonWhitespaceIndex = -1;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '\n') {
            line++;
            col = 0;
        } else {
            col++;
        }

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '{' || char === '[') {
            stack.push({ char, index: i, line, col });
        } else if (char === '}') {
            if (stack.length && stack[stack.length - 1].char === '{') {
                stack.pop();
            } else {
                stack.push({ char: '}', index: i, line, col, unexpected: true });
            }
        } else if (char === ']') {
            if (stack.length && stack[stack.length - 1].char === '[') {
                stack.pop();
            } else {
                stack.push({ char: ']', index: i, line, col, unexpected: true });
            }
        }

        if (!/\s/.test(char)) {
            lastNonWhitespaceIndex = i;
        }
    }

    const openItems = stack.filter(item => !item.unexpected);
    return {
        inString,
        escaped,
        stack,
        line,
        col,
        lastNonWhitespaceIndex,
        isTruncated: inString || openItems.length > 0
    };
}

export function findTruncationAnchor(text) {
    const raw = stripMarkdownFences(text);
    const scan = scanJson(raw);
    if (!scan.isTruncated) return null;

    const openBraces = scan.stack.filter(item => item.char === '{' && !item.unexpected);
    let startIndex = -1;

    if (openBraces.length > 0) {
        // Look for the enclosing question object brace {
        // If cut off inside options, question, explanation, etc., anchor from the start of the question
        for (let i = openBraces.length - 1; i >= 0; i--) {
            const candidate = openBraces[i];
            const slice = raw.slice(candidate.index);
            if (/"question"\s*:|"origin"\s*:/i.test(slice)) {
                startIndex = candidate.index;
                break;
            }
        }
        // If no question key found yet (e.g. cut off inside title of bank), use innermost unclosed {
        if (startIndex === -1) {
            startIndex = openBraces[openBraces.length - 1].index;
        }
    } else {
        // No unclosed {, but array is open (cut off right after a comma between questions)
        const lastBraceEnd = raw.lastIndexOf('}');
        if (lastBraceEnd !== -1) {
            const lastBraceStart = raw.lastIndexOf('{', lastBraceEnd);
            if (lastBraceStart !== -1) {
                startIndex = lastBraceStart;
            }
        }
    }

    if (startIndex === -1) {
        startIndex = Math.max(0, raw.length - 200);
    }

    const snippet = raw.slice(startIndex).trimEnd();
    return {
        startIndex,
        snippet,
        scan
    };
}

export function buildRepairPrompt(snippet) {
    const trimmed = String(snippet || '').trim();
    return `從 ${trimmed} 接續`;
}

export function autoRepairJson(text) {
    if (typeof text !== 'string') return '';
    let s = stripMarkdownFences(text);

    // 1. Remove trailing commas before } or ]
    s = s.replace(/,(\s*[\}\]])/g, '$1');

    // 2. Add missing comma between adjacent objects } {
    s = s.replace(/\}(\s*)\{/g, '},$1{');

    // 3. Add missing comma between property lines (e.g. "val"\n"key": or }\n"key":)
    s = s.replace(/("(?:\\.|[^"\\])*"|\d+|true|false|null|\}|\])\s*\n(\s*"[a-zA-Z0-9_ -]+"\s*:)/g, '$1,\n$2');

    // 4. Try parsing directly
    try {
        JSON.parse(s);
        return s;
    } catch {}

    // 5. Try balancing unclosed brackets/braces if the tail is clean
    const scan = scanJson(s);
    let balanced = s;
    if (scan.inString) {
        balanced += '"';
    }
    balanced = balanced.replace(/,\s*$/, '');
    const openItems = scanJson(balanced).stack.filter(item => !item.unexpected);
    if (openItems.length > 0) {
        const closers = openItems.slice().reverse().map(item => item.char === '{' ? '}' : ']').join('');
        const candidate = balanced + closers;
        try {
            JSON.parse(candidate);
            return candidate;
        } catch {}
    }

    return s;
}

export function locateJsonError(text, syntaxError) {
    if (!syntaxError) return { line: 1, col: 1, position: 0 };
    const msg = syntaxError.message || '';

    const lineColMatch = msg.match(/line (\d+) column (\d+)/i);
    if (lineColMatch) {
        return {
            line: parseInt(lineColMatch[1], 10),
            col: parseInt(lineColMatch[2], 10),
            position: -1
        };
    }

    const posMatch = msg.match(/at position (\d+)/i);
    if (posMatch) {
        const position = parseInt(posMatch[1], 10);
        const { line, col } = getLineColFromPosition(text, position);
        return { line, col, position };
    }

    if (/unexpected end/i.test(msg)) {
        const { line, col } = getLineColFromPosition(text, text.length);
        return { line, col, position: text.length };
    }

    const scan = scanJson(text);
    const unexpected = scan.stack.find(s => s.unexpected);
    if (unexpected) {
        return { line: unexpected.line, col: unexpected.col, position: unexpected.index };
    }

    return { line: scan.line, col: scan.col, position: text.length };
}

export function formatErrorSnippet(text, targetLine, targetCol, contextLines = 2) {
    const allLines = text.split('\n');
    const startLine = Math.max(1, targetLine - contextLines);
    const endLine = Math.min(allLines.length, targetLine + contextLines);
    const result = [];
    for (let l = startLine; l <= endLine; l++) {
        const lineContent = allLines[l - 1] ?? '';
        const isErrorLine = (l === targetLine);
        const prefix = `${isErrorLine ? '>' : ' '} ${String(l).padStart(3, ' ')} | `;
        result.push(prefix + lineContent);
        if (isErrorLine && targetCol > 0 && targetCol <= lineContent.length + 1) {
            const indent = ' '.repeat(prefix.length + Math.max(0, targetCol - 1));
            result.push(`${indent}^`);
        }
    }
    return result.join('\n');
}

export function diagnoseJson(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return {
            isValid: false,
            isEmpty: true,
            message: '請貼上 JSON 內容。'
        };
    }

    let parsed = null;
    let syntaxError = null;

    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        syntaxError = err;
    }

    if (!syntaxError) {
        return {
            isValid: true,
            value: parsed,
            cleanedText: raw,
            hasMarkdownFences: false
        };
    }

    const stripped = stripMarkdownFences(raw);
    const hasMarkdownFences = (raw !== stripped);
    const scan = scanJson(stripped);
    const isTruncated = scan.isTruncated || /unexpected end of json|unexpected end of input/i.test(syntaxError.message);

    let repairPrompt = '';
    let truncationAnchor = null;
    if (isTruncated) {
        truncationAnchor = findTruncationAnchor(stripped);
        if (truncationAnchor?.snippet) {
            repairPrompt = buildRepairPrompt(truncationAnchor.snippet);
        }
    }

    const repairedText = autoRepairJson(raw);
    let canAutoRepair = false;
    if (repairedText && repairedText !== raw) {
        try {
            JSON.parse(repairedText);
            canAutoRepair = true;
        } catch {}
    }

    const location = hasMarkdownFences && !raw.startsWith('{') && !raw.startsWith('[')
        ? { line: 1, col: 1, position: 0 }
        : locateJsonError(raw, syntaxError);
    const snippet = formatErrorSnippet(raw, location.line, location.col);

    let friendlyMessage = 'JSON 語法格式不正確。';
    if (hasMarkdownFences) {
        friendlyMessage = '貼上的內容包含 Markdown 標記（如 ```json 或 \'\'\'json）。';
    } else if (isTruncated) {
        friendlyMessage = 'JSON 內容未完成（中途中斷截斷）。';
    } else if (/unexpected token ','|expected/i.test(syntaxError.message)) {
        friendlyMessage = `第 ${location.line} 行附近語法錯誤，可能缺少逗號或引號未閉合。`;
    } else if (/trailing comma|unexpected token \}/i.test(syntaxError.message)) {
        friendlyMessage = `第 ${location.line} 行附近語法錯誤，可能有多餘的逗號。`;
    }

    return {
        isValid: false,
        syntaxError,
        isTruncated,
        truncationAnchor,
        repairPrompt,
        canAutoRepair,
        repairedText,
        hasMarkdownFences,
        location,
        snippet,
        message: friendlyMessage
    };
}

export function mergeContinuation(baseText, continuationText) {
    if (!baseText || !continuationText) {
        return { success: false, error: '缺少原有內容或接續內容。' };
    }

    const cleanBase = stripMarkdownFences(baseText).trimEnd();
    let cleanCont = stripMarkdownFences(continuationText).trim();

    // Strip AI conversational echo like "從 ... 接續"
    cleanCont = cleanCont.replace(/^從[\s\S]*?接續\s*/i, '').trim();
    cleanCont = stripMarkdownFences(cleanCont).trim();

    const anchor = findTruncationAnchor(cleanBase);
    const candidates = [];

    // Candidate 1: Direct concatenation
    candidates.push(cleanBase + cleanCont);

    // Candidate 2: Overlap splice
    const maxLookback = Math.min(2000, cleanBase.length, cleanCont.length);
    for (let len = maxLookback; len >= 1; len--) {
        const suffix = cleanBase.slice(-len);
        if (cleanCont.startsWith(suffix)) {
            candidates.push(cleanBase.slice(0, cleanBase.length - len) + cleanCont);
            break;
        }
    }

    // Candidate 3: Partial token replacement (e.g. "answ + "answer")
    const lastWordMatch = cleanBase.match(/(?:\"[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)$/);
    if (lastWordMatch) {
        const partial = lastWordMatch[0];
        if (cleanCont.startsWith(partial)) {
            candidates.push(cleanBase.slice(0, cleanBase.length - partial.length) + cleanCont);
        } else if (cleanCont.replace(/^"/, '').startsWith(partial.replace(/^"/, ''))) {
            candidates.push(cleanBase.slice(0, cleanBase.length - partial.length) + cleanCont);
        }
    }

    // Candidate 4: Replace from anchor index if continuation starts with {
    if (anchor && anchor.startIndex >= 0 && cleanCont.startsWith('{')) {
        candidates.push(cleanBase.slice(0, anchor.startIndex) + cleanCont);
    }

    // Candidate 5: Comma splice if base ended with } and continuation starts with {
    if (cleanBase.trimEnd().endsWith('}') && cleanCont.startsWith('{')) {
        candidates.push(cleanBase.trimEnd() + ',\n' + cleanCont);
    }

    const allCandidates = [];
    for (const c of candidates) {
        allCandidates.push(c);
        const repaired = autoRepairJson(c);
        if (repaired && repaired !== c) {
            allCandidates.push(repaired);
        }
    }

    for (const candidate of allCandidates) {
        try {
            const parsed = JSON.parse(candidate);
            return {
                success: true,
                mergedText: candidate,
                parsed
            };
        } catch {}
    }

    const fallback = autoRepairJson(cleanBase + '\n' + cleanCont);
    try {
        const parsed = JSON.parse(fallback);
        return {
            success: true,
            mergedText: fallback,
            parsed
        };
    } catch {
        return {
            success: false,
            error: '接續內容無法成功整合為正確的 JSON 格式，請確認貼上的接續文字。'
        };
    }
}
