const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { LabRuntime, urgency, toStoredTime } = require('../shared/lab-runtime');
const { database, seed } = require('./fixture');
const A = 'ECE201-A-01', B = 'ECE201-B-01';
let fixture, runtime, now;
const start = Date.UTC(2026, 8, 29, 5);
before(async () => { fixture = await database(start); });
after(async () => { await fixture?.close(); });
beforeEach(async () => { now = start; await seed(fixture.db, now); runtime = new LabRuntime(fixture.db, { now: () => now }); });
test('Quiz defaults to per-lab latest vote, with no database writes', async () => {
    await runtime.input(3416, 1); await runtime.input(3416, 1); await runtime.input(3417, 0);
    assert.deepEqual((await runtime.snapshot(A)).quiz, { yes: 1, no: 1, total: 2 });
    await runtime.input(3416, 0);
    assert.deepEqual((await runtime.snapshot(A)).quiz, { yes: 0, no: 2, total: 2 });
    assert.equal((await runtime.snapshot(B)).quiz.total, 0);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
    assert.equal(await fixture.db.collection('LabModes').countDocuments(), 0);
});
test('Feedback changes the same row, keeping only the latest per table across windows', async () => {
    await runtime.setMode(A, 'feedback');
    await runtime.input(3416, 0); await runtime.input(3416, 0); await runtime.input(3416, 1);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
    assert.equal((await fixture.db.collection('Responses').findOne({ tableID: 3416 })).response, true);
    await runtime.setMode(A, 'quiz'); await runtime.setMode(A, 'feedback'); await runtime.input(3416, 0);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
    assert.deepEqual((await runtime.snapshot(A)).feedback, { yes: 0, no: 1, total: 1 });
});
test('Five-minute boundary routes the next answer to Quiz and retains previous quiz answers', async () => {
    await runtime.input(3416, 1); await runtime.setMode(A, 'feedback');
    now += 299999; await runtime.input(3417, 0);
    now += 1; await runtime.input(3417, 1);
    const state = await runtime.snapshot(A);
    assert.equal(state.mode, 'quiz'); assert.deepEqual(state.quiz, { yes: 2, no: 0, total: 2 });
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
});
test('Mode metadata survives process restart; quiz answers do not', async () => {
    await runtime.input(3416, 1); const original = await runtime.setMode(A, 'feedback');
    now += 120000;
    runtime = new LabRuntime(fixture.db, { now: () => now });
    const restored = await runtime.snapshot(A);
    assert.equal(restored.feedbackEndsAt, original.feedbackEndsAt); assert.equal(restored.mode, 'feedback');
    assert.equal(restored.quiz.total, 0);
    await runtime.setMode(A, 'feedback'); assert.equal((await runtime.snapshot(A)).feedbackEndsAt, original.feedbackEndsAt);
    now = original.feedbackEndsAt; await runtime.tick(); assert.equal((await runtime.snapshot(A)).mode, 'quiz');
});
test('Leaving Feedback ends it; returning starts a fresh window; Reset touches quiz only', async () => {
    await runtime.input(3416, 1); await runtime.setMode(A, 'feedback'); await runtime.input(3416, 0);
    now += 10000; await runtime.setMode(A, 'quiz'); await runtime.reset(A);
    const restarted = await runtime.setMode(A, 'feedback');
    assert.equal(restarted.feedbackEndsAt, now + 300000); assert.equal(restarted.quiz.total, 0); assert.equal(restarted.feedback.total, 1);
    await assert.rejects(runtime.reset(A), /Switch to Quiz/);
});
test('Issue validation, idempotence, and all four frozen inputs until the next schedule', async () => {
    await runtime.input(3416, 2);
    await assert.rejects(runtime.issue(A, { tableID: 3416, issue: 'Others', remarks: '  ' }), /requires remarks/);
    await runtime.issue(A, { tableID: 3416, issue: 'Others', remarks: 'Broken lead' });
    await runtime.issue(A, { tableID: 3416, issue: 'Others', remarks: 'Duplicate' });
    for (const value of [0, 1, 2, 3]) assert.equal((await runtime.input(3416, value)).ignored, true);
    assert.equal(await fixture.db.collection('UnresolvedHelps').countDocuments(), 1);
    assert.equal(await fixture.db.collection('Helps').countDocuments(), 0);
    assert.equal((await runtime.snapshot(A)).quiz.total, 0);
    await runtime.setMode(A, 'feedback'); await runtime.input(3416, 1);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
    now = start + 3600000; await runtime.input(3416, 2);
    assert.equal((await runtime.snapshot('ECE201-A-02')).helps.length, 1);
});
test('Faulty equipment accepts optional remarks, stale requests and wrong labs are rejected', async () => {
    await assert.rejects(runtime.issue(A, { tableID: 3416, issue: 'Faulty Equipment' }), /no longer/);
    await runtime.input(3416, 2);
    await assert.rejects(runtime.issue(B, { tableID: 3416, issue: 'Faulty Equipment' }), /does not belong/);
    await runtime.issue(A, { tableID: 3416, issue: 'Faulty Equipment' });
    assert.equal((await runtime.snapshot(A)).unresolved[0].remarks, '');
});
test('Concurrent duplicate votes, help starts and issue/input races stay consistent', async () => {
    await runtime.setMode(A, 'feedback');
    await Promise.all(Array.from({ length: 12 }, () => runtime.input(3416, 1)));
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
    await Promise.all(Array.from({ length: 12 }, () => runtime.input(3416, 2)));
    assert.equal(await fixture.db.collection('Helps').countDocuments(), 1);
    await Promise.all([runtime.issue(A, { tableID: 3416, issue: 'Others', remarks: 'Test' }), runtime.input(3416, 2)]);
    const state = await runtime.snapshot(A); assert.equal(state.helps.length, 0); assert.equal(state.unresolved.length, 1);
});
test('Help release closes requests in both modes without writing responses', async () => {
    for (const mode of ['quiz', 'feedback']) { await runtime.setMode(A, mode); await runtime.input(3416, 2); await runtime.input(3416, 3); }
    assert.equal(await fixture.db.collection('Helps').countDocuments({ helpEnded: { $exists: true } }), 2);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
});
test('Session end truncates Feedback and clears quiz; exact end belongs to next lab', async () => {
    await runtime.input(3416, 1); now = start + 3590000;
    assert.equal((await runtime.setMode(A, 'feedback')).feedbackEndsAt, start + 3600000);
    now = start + 3600000; await runtime.tick();
    const closed = await runtime.snapshot(A); assert.equal(closed.active, false); assert.equal(closed.quiz.total, 0);
    await assert.rejects(runtime.setMode(A, 'feedback'), /not active/);
    await runtime.input(3416, 1); assert.equal((await runtime.snapshot('ECE201-A-02')).quiz.yes, 1);
});
test('Ambiguous overlapping schedules reject device inputs and mode changes', async () => {
    await fixture.db.collection('Schedule').insertOne({ labID: 'ECE999-A-01', labNo: 'Lab 301', startTime: toStoredTime(now - 1000), endTime: toStoredTime(now + 1000) });
    await assert.rejects(runtime.input(3416, 1), /Overlapping/);
    await assert.rejects(runtime.setMode(A, 'feedback'), /Overlapping/);
});
test('Urgency transitions at 7:00 and immediately after 15:00', () => {
    assert.equal(urgency(419999), ''); assert.equal(urgency(420000), 'help-medium');
    assert.equal(urgency(900000), 'help-medium'); assert.equal(urgency(900001), 'help-high');
});
test('Rapid opposite answers preserve receipt order even with slow initial lookups', async () => {
    const lookup = runtime.tableLab.bind(runtime);
    let calls = 0;
    runtime.tableLab = async (...args) => {
        if (calls++ === 0) await new Promise(resolve => setTimeout(resolve, 50));
        return lookup(...args);
    };
    await Promise.all([runtime.input(3416, 0), runtime.input(3416, 1)]);
    assert.deepEqual((await runtime.snapshot(A)).quiz, { yes: 1, no: 0, total: 1 });
});
async function delayedVoteBeforeControl(control) {
    let releaseLookup, lookupEntered;
    const gate = new Promise(resolve => { releaseLookup = resolve; });
    const entered = new Promise(resolve => { lookupEntered = resolve; });
    const lookup = runtime.tableLab.bind(runtime);
    let first = true;
    runtime.tableLab = async (...args) => {
        if (first) {
            first = false;
            lookupEntered();
            await gate;
        }
        return lookup(...args);
    };
    const vote = runtime.input(3416, 1);
    await entered;
    const schedule = runtime.schedule.bind(runtime);
    let controlStarted = false;
    runtime.schedule = async (...args) => {
        controlStarted = true;
        return schedule(...args);
    };
    const change = control();
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(controlStarted, false, 'A later control must not overtake a button awaiting its lab lookup');
    } finally {
        releaseLookup();
        await Promise.all([vote, change]);
    }
}

test('Quiz input received before a mode switch stays out of feedback despite a delayed lookup', async () => {
    await delayedVoteBeforeControl(() => runtime.setMode(A, 'feedback'));
    const state = await runtime.snapshot(A);
    assert.equal(state.mode, 'feedback');
    assert.deepEqual(state.quiz, { yes: 1, no: 0, total: 1 });
    assert.equal(state.feedback.total, 0);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
});

test('Feedback input received before a mode switch stays in feedback despite a delayed lookup', async () => {
    await runtime.setMode(A, 'feedback');
    await delayedVoteBeforeControl(() => runtime.setMode(A, 'quiz'));
    const state = await runtime.snapshot(A);
    assert.equal(state.mode, 'quiz');
    assert.equal(state.quiz.total, 0);
    assert.deepEqual(state.feedback, { yes: 1, no: 0, total: 1 });
    assert.equal(await fixture.db.collection('Responses').countDocuments({ labID: A, tableID: 3416, response: true }), 1);
});

test('Reset received after a delayed Quiz input clears that earlier input', async () => {
    await delayedVoteBeforeControl(() => runtime.reset(A));
    assert.equal((await runtime.snapshot(A)).quiz.total, 0);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
});

test('A mode switch received before a button applies to that button', async () => {
    await Promise.all([runtime.setMode(A, 'feedback'), runtime.input(3416, 1)]);
    const state = await runtime.snapshot(A);
    assert.equal(state.quiz.total, 0);
    assert.equal(state.feedback.yes, 1);
    assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
});

test('A lab processing a slow mutation does not block another lab after routing', { timeout: 5000 }, async () => {
    let releaseState, stateEntered;
    const gate = new Promise(resolve => { releaseState = resolve; });
    const entered = new Promise(resolve => { stateEntered = resolve; });
    const state = runtime.state.bind(runtime);
    let first = true;
    runtime.state = async lab => {
        if (lab.labID === A && first) {
            first = false;
            stateEntered();
            await gate;
        }
        return state(lab);
    };
    const firstVote = runtime.input(3416, 1);
    await entered;
    let deadline;
    try {
        await Promise.race([
            runtime.input(3501, 0),
            new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Other lab was blocked')), 1000); })
        ]);
        assert.deepEqual((await runtime.snapshot(B)).quiz, { yes: 0, no: 1, total: 1 });
    } finally {
        clearTimeout(deadline);
        releaseState();
        await firstVote;
    }
});

test('Failed metadata write does not silently change the active mode', async () => {
    runtime.saveMode = async () => { throw new Error('Storage unavailable'); };
    await assert.rejects(runtime.setMode(A, 'feedback'), /Storage unavailable/);
    assert.equal((await runtime.snapshot(A)).mode, 'quiz');
});
