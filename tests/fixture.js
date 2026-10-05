const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('../admin/node_modules/mongodb');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { toStoredTime } = require('../shared/lab-runtime');

async function database(now = Date.now()) {
    const mongo = await MongoMemoryServer.create();
    const client = new MongoClient(mongo.getUri());
    await client.connect();
    const db = client.db('SurveySyncVerification');
    await seed(db, now);
    return { mongo, client, db, close: async () => { await client.close(); await mongo.stop(); } };
}
async function seed(db, now) {
    await db.dropDatabase();
    await db.collection('Tables').insertMany([{ _id: 'Lab 301', tableID: 34 }, { _id: 'Lab 302', tableID: 35 }]);
    await db.collection('Schedule').insertMany([
        { _id: 'session-a', labID: 'ECE201-A-01', labNo: 'Lab 301', startTime: toStoredTime(now - 60000), endTime: toStoredTime(now + 3600000) },
        { _id: 'session-b', labID: 'ECE201-B-01', labNo: 'Lab 302', startTime: toStoredTime(now - 60000), endTime: toStoredTime(now + 3600000) },
        { _id: 'session-next', labID: 'ECE201-A-02', labNo: 'Lab 301', startTime: toStoredTime(now + 3600000), endTime: toStoredTime(now + 7200000) }
    ]);
    await db.collection('SeatLayouts').insertMany(['Lab 301', 'Lab 302'].map((room, i) => ({
        _id: room, totalRows: 4, seatsPerRow: 6, oddRowPosition: 'right',
        seats: Array.from({ length: 24 }, (_, n) => ({ row: Math.floor(n / 6), seat: n % 6, tableID: 3401 + i * 100 + n }))
    })));
}
async function services(fixture, ports = { admin: 14401, display: 14400, graphs: 13010 }) {
    const env = { ...process.env, MONGODB_URI: fixture.mongo.getUri(), MONGODB_DB: 'SurveySyncVerification',
        ADMIN_PORT: String(ports.admin), DISPLAY_HELP_PORT: String(ports.display), GRAPHS_PORT: String(ports.graphs),
        ADMIN_USERNAME: 'schedule-test', ADMIN_PASSWORD: 'schedule-secret',
        SEATMAP_USERNAME: 'labadmin', SEATMAP_PASSWORD: 'seatmap-local', HOST: '127.0.0.1', ADMIN_INTERNAL_HOST: '127.0.0.1' };
    let output = '';
    const children = ['admin', 'displayHelp', 'graphs'].map(service => {
        const child = spawn(process.execPath, [path.join(__dirname, '..', service, 'server.js')], { env, windowsHide: true });
        child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
        return child;
    });
    async function close() { for (const child of children) child.kill(); await Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))); }
    try {
        for (const port of Object.values(ports)) {
            let ready = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                try { await fetch(`http://127.0.0.1:${port}/`); ready = true; break; } catch {}
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (!ready) throw new Error(`Server ${port} failed to start: ${output}`);
        }
    } catch (error) { await close(); throw error; }
    return { ports, close, output: () => output };
}
module.exports = { database, seed, services };
