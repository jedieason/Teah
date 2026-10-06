export const GRADING_LEVELS = [
    ['relaxed', '寬鬆'], ['standard', '標準'], ['rigorous', '嚴謹'], ['exact', '絕對相同']
];

// Migrate the former spelling-only settings without re-enabling Gemini.
export function gradingLevel(value) {
    if (value === 'strict') return 'exact';
    if (value === 'moderate' || value === 'auto') return 'standard';
    return GRADING_LEVELS.some(([level]) => level === value) ? value : 'standard';
}

export function gradingOptions(options) {
    const { useGemini, ...rest } = options;
    return { ...rest, grading: gradingLevel(options.grading) };
}
