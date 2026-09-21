import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, set, get, remove, update, runTransaction } from 'firebase/database';
import { readFile } from 'node:fs/promises';
const env = await initializeTestEnvironment({ projectId: 'demo-teah', database: { host: '127.0.0.1', port: 9000, rules: await readFile('firebase/database.rules.example.json', 'utf8') } });
try {
    const alice = env.authenticatedContext('alice').database(), bob = env.authenticatedContext('bob').database(), anon = env.unauthenticatedContext().database();
    await env.withSecurityRulesDisabled(async c => { await set(ref(c.database()), { quizCatalog: { bank: { count: 1 } }, bank: [{ question: 'q' }], API_KEY: 'fake' }); });
    await assertFails(get(ref(alice)));
    await assertFails(get(ref(anon, 'API_KEY')));
    await assertSucceeds(get(ref(alice, 'API_KEY'))); // Explicit client-AI exception requested for this release.
    await assertFails(get(ref(anon, 'bank')));
    await assertSucceeds(get(ref(alice, 'bank')));
    await assertSucceeds(set(ref(alice, 'progress/alice/quizzes/test'), { currentIndex: 1 }));
    await assertFails(get(ref(bob, 'progress/alice')));
    await assertFails(set(ref(bob, 'mistakes/alice/x'), { count: 1 }));
    await assertSucceeds(set(ref(alice, 'learning/alice/plan'), { title: 'Plan' }));
    const event = { eventId: 'e1', questionId: 'q1', questionRevision: 1, sessionId: 's1', isCorrect: true, submittedAt: 1, responseTimeMs: 10, mode: 'study' };
    await assertSucceeds(set(ref(alice, 'learning/alice/attempts/e1'), event));
    await assertSucceeds(runTransaction(ref(alice, 'learning/alice/attempts/e1'), old => old ? undefined : event));
    await assertFails(set(ref(alice, 'learning/alice/attempts/e1'), { ...event, isCorrect: false }));
    await assertFails(remove(ref(alice, 'learning/alice/attempts/e1')));
    await assertFails(get(ref(bob, 'learning/alice')));
    await assertFails(set(ref(alice, 'learning/alice/attempts/bad'), {}));
    const contributor = env.authenticatedContext('writer', { contributor: true }).database();
    const reviewer = env.authenticatedContext('reviewer', { reviewer: true }).database();
    await assertFails(set(ref(contributor, 'bank'), []));
    await assertSucceeds(set(ref(contributor, 'contentDrafts/d1'), { bank: 'bank', questionsJson: JSON.stringify([{ question: 'q' }]), status: 'draft', author: 'writer', createdAt: 1 }));
    await assertSucceeds(update(ref(contributor, 'contentDrafts/d1'), { status: 'review' }));
    await assertFails(update(ref(contributor, 'contentDrafts/d1'), { status: 'approved', reviewer: 'writer' }));
    await assertSucceeds(update(ref(reviewer, 'contentDrafts/d1'), { status: 'approved', reviewer: 'reviewer', reviewedAt: 2 }));
    await assertFails(set(ref(alice, 'quizCatalog/learning'), { count: 1 }));
    await assertFails(update(ref(reviewer, 'contentDrafts/d1'), { questionsJson: '[]' }));
    await assertSucceeds(set(ref(alice, 'feedback/alice/t1'), { questionId: 'q1', questionRevision: 1, reason: '錯字', status: 'open', createdAt: 1 }));
    await assertFails(get(ref(bob, 'feedback/alice')));
    await assertFails(update(ref(alice, 'feedback/alice/t1'), { status: 'resolved' }));
    await assertSucceeds(update(ref(reviewer, 'feedback/alice/t1'), { status: 'resolved', resolution: '已修正' }));
    await assertSucceeds(remove(ref(alice, 'learning/alice')));
    console.log('Rules passed: root/anonymous key denial, account isolation, immutable events, draft review roles and account deletion.');
} finally { await env.cleanup(); }
