(function (root) {
    'use strict';
    // Tracks request identities, not repeated button messages or queue positions.
    class HelpAlerts {
        constructor({ play, schedule = (fn, delay) => setTimeout(fn, delay), cancel = id => clearTimeout(id), now = Date.now }) {
            this.play = play; this.schedule = schedule; this.cancel = cancel; this.now = now;
            this.enabled = false; this.seen = new Set(); this.pending = new Set();
            this.baseline = true; this.timer = null; this.lastPlayedAt = -Infinity;
        }
        clearPending() {
            if (this.timer !== null) this.cancel(this.timer);
            this.timer = null; this.pending.clear();
        }
        rebaseline() { this.baseline = true; this.clearPending(); }
        setEnabled(enabled) {
            this.enabled = enabled;
            if (!enabled) this.clearPending();
        }
        update(helps, active) {
            const ids = new Set(helps.map(help => help.requestID || `${help.tableID}:${help.startedAt}`));
            for (const id of this.pending) if (!ids.has(id)) this.pending.delete(id);
            for (const id of ids) {
                if (!this.baseline && !this.seen.has(id) && this.enabled && active) this.pending.add(id);
                this.seen.add(id);
            }
            this.baseline = false;
            if (!active) { this.clearPending(); return; }
            if (this.pending.size && this.timer === null) {
                this.timer = this.schedule(() => {
                    this.timer = null;
                    if (this.pending.size && this.enabled) {
                        this.pending.clear(); this.lastPlayedAt = this.now(); this.play();
                    }
                }, Math.max(350, this.lastPlayedAt + 1500 - this.now()));
            }
        }
    }
    if (typeof module === 'object' && module.exports) module.exports = HelpAlerts;
    else root.SurveySyncHelpAlerts = HelpAlerts;
})(typeof globalThis === 'object' ? globalThis : this);
