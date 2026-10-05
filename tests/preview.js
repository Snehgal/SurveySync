// Disposable localhost preview. Never reads or writes the application's MongoDB.
const { database, services } = require('./fixture');
const { toStoredTime } = require('../shared/lab-runtime');
(async () => {
    const fixture = await database();
    const now = Date.now();
    // Keep the disposable demonstration available through a working day.
    await fixture.db.collection('Schedule').updateMany({ labID: { $in: ['ECE201-A-01', 'ECE201-B-01'] } }, { $set: { endTime: toStoredTime(now + 12 * 3600000) } });
    await fixture.db.collection('Schedule').updateOne({ labID: 'ECE201-A-02' }, { $set: { startTime: toStoredTime(now + 12 * 3600000), endTime: toStoredTime(now + 13 * 3600000) } });
    await fixture.db.collection('Helps').insertMany([
        { labID: 'ECE201-A-01', tableID: 3402, helpStarted: toStoredTime(now - 2 * 60000) },
        { labID: 'ECE201-A-01', tableID: 3409, helpStarted: toStoredTime(now - 9 * 60000) },
        { labID: 'ECE201-A-01', tableID: 3420, helpStarted: toStoredTime(now - 17 * 60000) }
    ]);
    await fixture.db.collection('UnresolvedHelps').insertOne({ labID: 'ECE201-A-01', tableID: 3414, issue: 'Faulty Equipment', remarks: 'Oscilloscope display not working', issueRaised: toStoredTime(now) });
    const apps = await services(fixture, { admin: 4401, display: 4400, graphs: 4310 });
    console.log('Isolated preview: http://localhost:4400 - labadmin / seatmap-local');
    const close = async () => { await apps.close(); await fixture.close(); process.exit(); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error); process.exitCode = 1; });
