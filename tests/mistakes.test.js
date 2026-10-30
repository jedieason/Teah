import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenMistakes, filterMistakes, canonicalQuestion, applyAttempt, preparePractice, getArchivedBankKeys, isArchivedMistake } from '../src/features/mistakes/model.js';
import { validateQuiz } from '../src/shared/content.js';

test('legacy nested paths remain addressable without changing Firebase keys', () => {
    const rows = flattenMistakes({ '藥理｜B10': { abc: { def: { question: 'Q', count: 3 } } } });
    assert.equal(rows[0].recordPath, 'abc/def');
    assert.equal(rows[0].subject, '藥理');
    assert.equal(rows[0].title, 'B10');
});
test('two consecutive correct attempts master a question; later error reopens it', () => {
    const snapshot = { question: 'Q', answer: 'A' };
    let m = applyAttempt(null, snapshot, { correct: false, now: 1, eventId: '1' });
    m = applyAttempt(m, snapshot, { correct: true, now: 2, eventId: '2' });
    assert.equal(m.status, 'active');
    m = applyAttempt(m, snapshot, { correct: true, now: 3, eventId: '3' });
    assert.equal(m.status, 'mastered'); assert.equal(m.count, 1);
    m = applyAttempt(m, snapshot, { correct: false, now: 4, eventId: '4' });
    assert.equal(m.status, 'active'); assert.equal(m.correctStreak, 0); assert.equal(m.count, 2);
    assert.equal(m.firstMistake, 1);
});
test('retried events cannot double-count mistakes', () => {
    const event = { correct: false, now: 10, eventId: 'same-event' };
    const m = applyAttempt(null, { question: 'Q' }, event);
    assert.deepEqual(applyAttempt(m, { question: 'Q' }, event), m);
});
test('shuffle mapping restores original options, multiple answers, selection and explanation', () => {
    const q = canonicalQuestion({ question: 'Q', options: { A: 'second', B: 'first', C: 'third' },
        answer: ['A', 'C'], userSelection: ['B'], reverseLabelMapping: { A: 'B', B: 'A', C: 'C' }, explanation: '(A) yes (B) no' });
    assert.deepEqual(q.options, { B: 'second', A: 'first', C: 'third' });
    assert.deepEqual(q.answer, ['B', 'C']); assert.deepEqual(q.lastSelection, ['A']);
    assert.equal(q.explanation, '(B) yes (A) no');
});
test('fill-in and single element legacy arrays are normalized for practice', () => {
    const single = preparePractice({ question: 'Q', options: { A: '1', B: '2' }, answer: ['A'], quizKey: 'unit', recordPath: 'key' });
    assert.equal(single.answer, 'A'); assert.equal(single.isMultiSelect, false);
    const fill = preparePractice({ question: 'Q', answer: ['BCR', 'ABL'], quizKey: 'unit', recordPath: 'key' });
    assert.equal(fill.isFillBlank, true); assert.deepEqual(fill.answer, ['BCR', 'ABL']);
    assert.equal(fill.sourcePath, 'unit'); assert.equal(fill.mistakeRecordPath, 'key');
});
test('filters combine words, bank, subject and status without mutating the input', () => {
    const rows = flattenMistakes({ '檢驗｜B10': { a: { question: 'PCR Ct value', count: 2, lastMistake: 10 }, b: { question: 'PCR', status: 'mastered', count: 4, lastMistake: 20 } }, '藥理｜B09': { c: { question: 'PCR', count: 1 } } });
    assert.equal(filterMistakes(rows, { query: 'PCR Ct', subject: '檢驗' }).length, 1);
    assert.equal(filterMistakes(rows, { status: 'mastered' })[0].recordPath, 'b');
    assert.equal(filterMistakes(rows, { status: 'all', sort: 'frequent' })[0].recordPath, 'b');
    assert.equal(rows[0].recordPath, 'a');
});
test('filterMistakes supports multiple subjects simultaneously', () => {
    const rows = flattenMistakes({
        '生理｜A01': { a: { question: 'Physiology Q1' } },
        '病理｜B01': { b: { question: 'Pathology Q1' } },
        '藥理｜C01': { c: { question: 'Pharmacology Q1' } }
    });
    const multi = filterMistakes(rows, { subject: ['生理', '藥理'] });
    assert.equal(multi.length, 2);
    assert.ok(multi.some(m => m.subject === '生理'));
    assert.ok(multi.some(m => m.subject === '藥理'));
    assert.ok(!multi.some(m => m.subject === '病理'));

    const all = filterMistakes(rows, { subject: [] });
    assert.equal(all.length, 3);

    const named = filterMistakes(rows, { subjects: ['病理'] });
    assert.equal(named.length, 1);
    assert.equal(named[0].subject, '病理');
});
test('malformed banks are rejected before upload', () => {
    assert.throws(() => validateQuiz([]));
    assert.throws(() => validateQuiz([{ question: 'Q', options: { A: '1', B: '2' }, answer: 'C' }]));
    assert.throws(() => validateQuiz([{ question: 'Q', answer: [] }]));
    assert.equal(validateQuiz([{ question: 'Q', answer: ['BCR'] }]).length, 1);
});

test('getArchivedBankKeys and isArchivedMistake detect archived bank mistakes accurately', () => {
    const catalog = {
        '_Archive_生理學實驗｜B09': { count: 28, storageKey: '生理學實驗｜B09' },
        '_Archive_神經解剖學｜B08 期末.json': { count: 10, storageKey: '神經解剖學｜B08 期末' },
        '檢驗醫學區段一｜B04 考古': { count: 50, storageKey: '檢驗醫學區段一｜B04 考古' }
    };
    const archivedKeys = getArchivedBankKeys(catalog);
    assert.ok(archivedKeys.has('_Archive_生理學實驗｜B09'));
    assert.ok(archivedKeys.has('生理學實驗｜B09'));
    assert.ok(archivedKeys.has('神經解剖學｜B08 期末'));
    assert.ok(!archivedKeys.has('檢驗醫學區段一｜B04 考古'));

    // Directly prefixed mistakes
    assert.ok(isArchivedMistake({ quizKey: '_Archive_隨意科目｜T01' }));
    assert.ok(isArchivedMistake({ quizKey: '隨意科目｜T01', sourcePath: '_Archive_隨意科目｜T01.json' }));
    assert.ok(isArchivedMistake({ quizKey: '隨意科目｜T01', origin: '_Archive_隨意科目｜T01' }));

    // Storage key in catalog
    assert.ok(isArchivedMistake({ quizKey: '生理學實驗｜B09' }, catalog));
    assert.ok(isArchivedMistake({ quizKey: '神經解剖學｜B08 期末' }, catalog));

    // Active bank in catalog
    assert.ok(!isArchivedMistake({ quizKey: '檢驗醫學區段一｜B04 考古' }, catalog));
});

test('filterMistakes excludes archived bank questions when excludeArchived is true', () => {
    const catalog = {
        '_Archive_生理學實驗｜B09': { count: 28, storageKey: '生理學實驗｜B09' },
        '檢驗醫學區段一｜B04 考古': { count: 50, storageKey: '檢驗醫學區段一｜B04 考古' }
    };
    const rows = flattenMistakes({
        '生理學實驗｜B09': { a: { question: 'Archived mistake Q1' } },
        '_Archive_神經解剖學｜B08': { b: { question: 'Direct archived Q2' } },
        '檢驗醫學區段一｜B04 考古': { c: { question: 'Active mistake Q3' } }
    });

    const filtered = filterMistakes(rows, { catalog, excludeArchived: true });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].question, 'Active mistake Q3');
    assert.equal(filtered[0].quizKey, '檢驗醫學區段一｜B04 考古');
});

test('filterMistakes combines active status, query, subjects, and excludeArchived correctly', () => {
    const catalog = {
        '_Archive_生理學實驗｜B09': { count: 28, storageKey: '生理學實驗｜B09' },
        '_Archive_神經解剖學｜B08': { count: 15, storageKey: '神經解剖學｜B08' },
        '檢驗醫學區段一｜B04 考古': { count: 50, storageKey: '檢驗醫學區段一｜B04 考古' },
        '藥理區段一｜B10 考古': { count: 40, storageKey: '藥理區段一｜B10 考古' }
    };
    const rows = flattenMistakes({
        '生理學實驗｜B09': {
            a: { question: 'Archived mistake Q1 (active status)', status: 'active', count: 1, lastMistake: 10 }
        },
        '_Archive_神經解剖學｜B08': {
            b: { question: 'Direct archived Q2 (mastered)', status: 'mastered', count: 2, lastMistake: 20 }
        },
        '檢驗醫學區段一｜B04 考古': {
            c: { question: 'Active mistake Q3 (PCR test)', status: 'active', count: 3, lastMistake: 30 }
        },
        '藥理區段一｜B10 考古': {
            d: { question: 'Active mistake Q4 (PCR drug)', status: 'mastered', count: 4, lastMistake: 40 }
        }
    });

    // Default excludeArchived: false includes all rows
    assert.equal(filterMistakes(rows, { status: 'all' }).length, 4);

    // excludeArchived: true filters out both archived items
    const nonArchivedAll = filterMistakes(rows, { catalog, excludeArchived: true, status: 'all' });
    assert.equal(nonArchivedAll.length, 2);
    assert.deepEqual(nonArchivedAll.map(m => m.quizKey).sort(), ['檢驗醫學區段一｜B04 考古', '藥理區段一｜B10 考古']);

    // Combine excludeArchived with status: 'active'
    const nonArchivedActive = filterMistakes(rows, { catalog, excludeArchived: true, status: 'active' });
    assert.equal(nonArchivedActive.length, 1);
    assert.equal(nonArchivedActive[0].question, 'Active mistake Q3 (PCR test)');

    // Combine excludeArchived with query
    const queried = filterMistakes(rows, { catalog, excludeArchived: true, status: 'all', query: 'PCR' });
    assert.equal(queried.length, 2);

    // Combine excludeArchived with subject
    const subjectFiltered = filterMistakes(rows, { catalog, excludeArchived: true, status: 'all', subject: '藥理區段一' });
    assert.equal(subjectFiltered.length, 1);
    assert.equal(subjectFiltered[0].quizKey, '藥理區段一｜B10 考古');
});

test('getArchivedBankKeys prioritizes active catalog bank if name collision occurs', () => {
    // If an active bank exists with name X, X should not be treated as archived even if an old archive existed
    const catalog = {
        '_Archive_微生物｜期中考': { count: 20, storageKey: '微生物｜期中考' },
        '微生物｜期中考': { count: 25, storageKey: '微生物｜期中考' }
    };
    const archivedKeys = getArchivedBankKeys(catalog);
    assert.ok(archivedKeys.has('_Archive_微生物｜期中考'));
    assert.ok(!archivedKeys.has('微生物｜期中考'));

    assert.ok(isArchivedMistake({ quizKey: '_Archive_微生物｜期中考' }, catalog));
    assert.ok(!isArchivedMistake({ quizKey: '微生物｜期中考' }, catalog));
});
