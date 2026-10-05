const IST_OFFSET = 330 * 60 * 1000;
const FEEDBACK_MS = 5 * 60 * 1000;
const toStoredTime = ms => new Date(ms + IST_OFFSET);
const fromStoredTime = value => new Date(value).getTime() - IST_OFFSET;
function urgency(elapsed) {
    return elapsed > 15 * 60000 ? 'help-high' : elapsed >= 7 * 60000 ? 'help-medium' : '';
}
function counts(votes) {
    const values = Array.from(votes.values());
    const yes = values.filter(v => v === 1).length;
    return { yes, no: values.length - yes, total: values.length };
}

// One coordinator in the admin process owns all device and browser mutations.
// Quiz votes never leave this in-memory map. Only feedback and mode metadata persist.
class LabRuntime {
    constructor(db, { now = Date.now, onChange = () => {} } = {}) {
        this.db = db;
        this.now = now;
        this.onChange = onChange;
        this.states = new Map();
        this.queues = new Map();
        this.routingKey = Symbol('mutation-routing');
    }
    serial(labID, fn) {
        const previous = this.queues.get(labID) || Promise.resolve();
        const next = previous.catch(() => {}).then(fn);
        this.queues.set(labID, next);
        next.finally(() => { if (this.queues.get(labID) === next) this.queues.delete(labID); }).catch(() => {});
        return next;
    }
    routeMutation(fn) {
        // Order receipt before asynchronous table lookup can let a later control
        // overtake an input. Release routing once the operation enters its lab
        // queue; processing in separate labs can still run concurrently.
        return this.serial(this.routingKey, fn).then(({ operation }) => operation);
    }
    mutate(labID, fn) {
        return this.routeMutation(() => ({ operation: this.serial(labID, fn) }));
    }
    async schedule(labID) {
        const lab = await this.db.collection('Schedule').findOne({ labID });
        if (!lab) throw new Error('Lab session not found.');
        return lab;
    }
    active(lab) {
        const now = this.now();
        return fromStoredTime(lab.startTime) <= now && now < fromStoredTime(lab.endTime);
    }
    async tableLab(tableID) {
        const room = await this.db.collection('Tables').findOne({ tableID: Math.floor(tableID / 100) });
        if (!room) throw new Error('Unknown table room.');
        const time = toStoredTime(this.now());
        const labs = await this.db.collection('Schedule').find({ labNo: room._id, startTime: { $lte: time }, endTime: { $gt: time } }).toArray();
        if (labs.length !== 1) throw new Error(labs.length ? 'Overlapping lab schedules: input rejected.' : 'No active lab session.');
        return labs[0];
    }
    async state(lab) {
        let state = this.states.get(lab.labID);
        if (!state) {
            const saved = await this.db.collection('LabModes').findOne({ _id: String(lab._id) });
            state = { mode: saved?.mode || 'quiz', feedbackEndsAt: saved?.feedbackEndsAt ? new Date(saved.feedbackEndsAt).getTime() : null, votes: new Map() };
            this.states.set(lab.labID, state);
        }
        if (!this.active(lab) || (state.mode === 'feedback' && this.now() >= state.feedbackEndsAt)) {
            const changed = state.mode !== 'quiz';
            state.mode = 'quiz';
            state.feedbackEndsAt = null;
            if (!this.active(lab)) state.votes.clear();
            if (changed) await this.saveMode(lab, state);
        }
        return state;
    }
    async saveMode(lab, state) {
        await this.db.collection('LabModes').updateOne({ _id: String(lab._id) }, { $set: {
            labID: lab.labID, mode: state.mode,
            feedbackEndsAt: state.feedbackEndsAt ? new Date(state.feedbackEndsAt) : null
        } }, { upsert: true });
    }
    async snapshotUnlocked(lab) {
        const state = await this.state(lab);
        const [helps, unresolved, responses] = await Promise.all([
            this.db.collection('Helps').find({ labID: lab.labID, helpEnded: { $exists: false } }).toArray(),
            this.db.collection('UnresolvedHelps').find({ labID: lab.labID }).toArray(),
            this.db.collection('Responses').find({ labID: lab.labID }).toArray()
        ]);
        const feedback = new Map(responses.sort((a, b) => new Date(a.date) - new Date(b.date)).map(r => [r.tableID, r.response ? 1 : 0]));
        const frozen = new Set(unresolved.map(h => h.tableID));
        return {
            labID: lab.labID, labNo: lab.labNo, active: this.active(lab), mode: state.mode,
            serverNow: this.now(), sessionEndsAt: fromStoredTime(lab.endTime), feedbackEndsAt: state.feedbackEndsAt,
            quiz: counts(state.votes), feedback: counts(feedback),
            helps: helps.filter(h => !frozen.has(h.tableID)).map(h => ({ tableID: h.tableID, startedAt: fromStoredTime(h.helpStarted) })),
            unresolved: unresolved.map(h => ({ tableID: h.tableID, issue: h.issue, remarks: h.remarks || '' }))
        };
    }
    snapshot(labID) { return this.serial(labID, async () => this.snapshotUnlocked(await this.schedule(labID))); }
    async publish(lab) {
        const snapshot = await this.snapshotUnlocked(lab);
        this.onChange(snapshot);
        return snapshot;
    }
    async assertActive(lab) {
        if (!this.active(lab)) throw new Error('This lab session is not active.');
        const time = toStoredTime(this.now());
        const simultaneous = await this.db.collection('Schedule').find({ labNo: lab.labNo, startTime: { $lte: time }, endTime: { $gt: time } }).toArray();
        if (simultaneous.length !== 1) throw new Error('Overlapping lab schedules must be corrected before collecting inputs.');
    }
    setMode(labID, mode) {
        return this.mutate(labID, async () => {
            if (!['quiz', 'feedback'].includes(mode)) throw new Error('Invalid mode.');
            const lab = await this.schedule(labID);
            await this.assertActive(lab);
            const state = await this.state(lab);
            // Duplicate clicks or another viewer choosing the current mode never restart the timer.
            if (state.mode !== mode) {
                const next = { mode, feedbackEndsAt: mode === 'feedback' ? Math.min(this.now() + FEEDBACK_MS, fromStoredTime(lab.endTime)) : null };
                await this.saveMode(lab, next);
                Object.assign(state, next);
            }
            return this.publish(lab);
        });
    }
    reset(labID) {
        return this.mutate(labID, async () => {
            const lab = await this.schedule(labID);
            await this.assertActive(lab);
            const state = await this.state(lab);
            if (state.mode !== 'quiz') throw new Error('Switch to Quiz to reset quiz answers.');
            state.votes.clear();
            return this.publish(lab);
        });
    }
    issue(labID, { tableID, issue, remarks = '' }) {
        return this.mutate(labID, async () => {
            if (!Number.isSafeInteger(tableID) || !['Faulty Equipment', 'Others'].includes(issue) || typeof remarks !== 'string') throw new Error('Choose a valid table and issue.');
            remarks = remarks.trim();
            if (remarks.length > 1000 || (issue === 'Others' && !remarks)) throw new Error('Others requires remarks; maximum 1000 characters.');
            const lab = await this.schedule(labID);
            await this.assertActive(lab);
            const mapped = await this.tableLab(tableID);
            if (mapped.labID !== labID) throw new Error('Table does not belong to this session.');
            const existing = await this.db.collection('UnresolvedHelps').findOne({ labID, tableID });
            const help = await this.db.collection('Helps').findOne({ labID, tableID, helpEnded: { $exists: false } });
            if (!existing && !help) throw new Error('This table no longer has an active help request.');
            if (!existing) await this.db.collection('UnresolvedHelps').updateOne({ labID, tableID }, { $setOnInsert: {
                labID, tableID, issue, remarks, issueRaised: toStoredTime(this.now()), helpStarted: help.helpStarted
            } }, { upsert: true });
            // Persist the freeze first. Even a failed cleanup cannot reopen the seat.
            await this.db.collection('Helps').deleteMany({ labID, tableID, helpEnded: { $exists: false } });
            return this.publish(lab);
        });
    }
    async input(tableID, value) {
        if (!Number.isSafeInteger(tableID) || ![0, 1, 2, 3].includes(value)) throw new Error('Invalid device input.');
        // Inputs and operator controls share receipt ordering before lookup.
        return this.routeMutation(async () => {
            const initialLab = await this.tableLab(tableID);
            return { operation: this.serial(initialLab.labID, async () => {
                const lab = await this.tableLab(tableID); // Recheck after queued work and session boundaries.
                if (lab.labID !== initialLab.labID) throw new Error('Lab session changed; please press again.');
                const labID = lab.labID;
                if (await this.db.collection('UnresolvedHelps').findOne({ labID, tableID })) return { ignored: true, reason: 'Seat frozen for this lab session.' };
                const state = await this.state(lab);
                if (value === 0 || value === 1) {
                    if (state.mode === 'quiz') state.votes.set(tableID, value);
                    else await this.db.collection('Responses').updateOne({ labID, tableID }, { $set: { response: value === 1, date: toStoredTime(this.now()) } }, { upsert: true });
                } else if (value === 2) {
                    await this.db.collection('Helps').updateOne({ labID, tableID, helpEnded: { $exists: false } }, { $setOnInsert: { labID, tableID, helpStarted: toStoredTime(this.now()) } }, { upsert: true });
                } else {
                    await this.db.collection('Helps').updateMany({ labID, tableID, helpEnded: { $exists: false } }, { $set: { helpEnded: toStoredTime(this.now()) } });
                }
                return this.publish(lab);
            }) };
        });
    }
    async tick() {
        for (const labID of this.states.keys()) {
            await this.serial(labID, async () => {
                const lab = await this.schedule(labID);
                const state = this.states.get(labID);
                if (!this.active(lab) || (state.mode === 'feedback' && this.now() >= state.feedbackEndsAt)) {
                    await this.publish(lab);
                    if (!this.active(lab)) this.states.delete(labID);
                }
            }).catch(error => console.error('Lab timer:', error.message));
        }
    }
}
module.exports = { LabRuntime, IST_OFFSET, FEEDBACK_MS, fromStoredTime, toStoredTime, urgency };
