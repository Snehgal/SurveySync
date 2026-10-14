const { test } = require('node:test');
const assert = require('node:assert/strict');
const HelpAlerts = require('../displayHelp/public/help-alerts');
const help = (id, tableID = 3416) => ({ requestID: id, tableID, startedAt: 1 });
function harness() {
    let now = 0, plays = 0, sequence = 0;
    const tasks = new Map();
    const alerts = new HelpAlerts({ play: () => plays++, now: () => now,
        schedule(fn, delay) { const id = ++sequence; tasks.set(id, { fn, at: now + delay }); return id; },
        cancel(id) { tasks.delete(id); } });
    function advance(ms = 2000) {
        const target = now + ms;
        while (true) {
            const next = [...tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; tasks.delete(next[0]); next[1].fn();
        }
        now = target;
    }
    return { alerts, advance, plays: () => plays };
}
test('Sound defaults off, and enabling it never replays existing requests', () => {
    const h = harness(); assert.equal(h.alerts.enabled, false);
    h.alerts.update([], true); h.alerts.update([help('a')], true); h.advance();
    h.alerts.setEnabled(true); h.alerts.update([help('a')], true); h.advance();
    assert.equal(h.plays(), 0);
});
test('Default browser timers are invoked without binding them to the HelpAlerts instance', () => {
    const originalSchedule = globalThis.setTimeout, originalCancel = globalThis.clearTimeout;
    let scheduled = false, cancelled = false;
    try {
        globalThis.setTimeout = function () { assert.equal(this instanceof HelpAlerts, false); scheduled = true; return 1; };
        globalThis.clearTimeout = function () { assert.equal(this instanceof HelpAlerts, false); cancelled = true; };
        const alerts = new HelpAlerts({ play() {} });
        alerts.update([], true); alerts.setEnabled(true); alerts.update([help('a')], true); alerts.setEnabled(false);
        assert.equal(scheduled, true); assert.equal(cancelled, true);
    } finally { globalThis.setTimeout = originalSchedule; globalThis.clearTimeout = originalCancel; }
});
test('Page load is silent even when sound is enabled before the first snapshot', () => {
    const h = harness(); h.alerts.setEnabled(true); h.alerts.update([help('old')], true); h.advance();
    assert.equal(h.plays(), 0);
});
test('Only new request identities chime; duplicate inputs and rank changes do not', () => {
    const h = harness(); h.alerts.update([], true); h.alerts.setEnabled(true);
    h.alerts.update([help('a')], true); h.advance();
    h.alerts.update([{ ...help('a'), rank: 2 }], true); h.advance();
    assert.equal(h.plays(), 1);
    h.alerts.update([], true); h.alerts.update([help('b')], true); h.advance();
    assert.equal(h.plays(), 2);
});
test('A burst of help requests produces one chime and subsequent alerts obey the cooldown', () => {
    const h = harness(); h.alerts.update([], true); h.alerts.setEnabled(true);
    h.alerts.update([help('a')], true); h.advance(100);
    h.alerts.update([help('a'), help('b', 3417)], true); h.advance(250);
    assert.equal(h.plays(), 1);
    h.alerts.update([help('a'), help('b', 3417), help('c', 3418)], true);
    h.advance(1499); assert.equal(h.plays(), 1);
    h.advance(1); assert.equal(h.plays(), 2);
});
test('Reconnect baselines suppress missed requests and cancel pending alerts', () => {
    const h = harness(); h.alerts.update([], true); h.alerts.setEnabled(true);
    h.alerts.update([help('a')], true); h.alerts.rebaseline();
    h.alerts.update([help('a'), help('b', 3417)], true); h.advance(); assert.equal(h.plays(), 0);
    h.alerts.update([help('a'), help('b', 3417), help('c', 3418)], true); h.advance(); assert.equal(h.plays(), 1);
});
test('Muting, session closure and a request ending before the chime all suppress pending audio', () => {
    for (const action of ['mute', 'closed', 'ended']) {
        const h = harness(); h.alerts.update([], true); h.alerts.setEnabled(true); h.alerts.update([help('a')], true);
        if (action === 'mute') h.alerts.setEnabled(false);
        else h.alerts.update(action === 'ended' ? [] : [help('a')], action !== 'closed');
        h.advance(); assert.equal(h.plays(), 0, action);
    }
});
