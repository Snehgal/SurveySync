const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('../admin/node_modules/ws');
const { database, services } = require('./fixture');

test('Real HTTP, firmware WebSocket, authenticated live stream, database and analytics flow', { timeout: 120000 }, async () => {
    const fixture = await database();
    let apps, ws, reader;
    const streamAbort = new AbortController();
    try {
        apps = await services(fixture);
        const display = `http://127.0.0.1:${apps.ports.display}`;
        const admin = `http://127.0.0.1:${apps.ports.admin}`;
        const graphs = `http://127.0.0.1:${apps.ports.graphs}`;
        const lab = '/api/labs/ECE201-A-01';
        const post = (url, body, cookie = '') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
        assert.equal((await fetch(display + '/lab/ECE201-A-01/map', { redirect: 'manual' })).status, 302);
        assert.equal((await fetch(display + '/?format=json', { redirect: 'manual' })).status, 302);
        assert.equal((await post(display + lab + '/mode', { mode: 'feedback' })).status, 401);
        assert.equal((await fetch(admin + '/seat-api/labs/ECE201-A-01/state')).status, 401);
        const adminLogin = await post(admin + '/login', { username: 'schedule-test', password: 'schedule-secret' });
        const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
        assert.equal((await fetch(display + lab + '/state', { headers: { cookie: adminCookie } })).status, 401);
        assert.equal((await post(display + '/login', { username: 'schedule-test', password: 'schedule-secret' })).status, 401);
        const login = await post(display + '/login', { username: 'labadmin', password: 'seatmap-local' });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.match(cookie, /^ss_seatmap=/);
        const ongoingLabs = async () => {
            const response = await fetch(display + '/?format=json', { headers: { cookie } });
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /application\/json/);
            return (await response.json()).labs;
        };
        assert.deepEqual(await ongoingLabs(), [
            { labID: 'ECE201-A-01', labNumber: 'Lab 301' },
            { labID: 'ECE201-B-01', labNumber: 'Lab 302' }
        ]);
        const otherSchedule = await fixture.db.collection('Schedule').findOne({ labID: 'ECE201-B-01' });
        await fixture.db.collection('Schedule').deleteOne({ _id: otherSchedule._id });
        assert.deepEqual(await ongoingLabs(), [{ labID: 'ECE201-A-01', labNumber: 'Lab 301' }]);
        await fixture.db.collection('Schedule').insertOne(otherSchedule);
        assert.equal((await ongoingLabs()).length, 2);
        assert.equal((await fetch(admin + '/get-records', { headers: { cookie } })).status, 401);
        for (const route of ['/', '/lab/ECE201-A-01', '/lab/ECE201-A-01/map']) {
            const page = await fetch(display + route, { headers: { cookie } }); assert.equal(page.status, 200);
            const html = await page.text(); assert.doesNotMatch(html, /onclick="logIssue/);
        }
        const stream = await fetch(display + lab + '/events', { headers: { cookie }, signal: streamAbort.signal });
        assert.equal(stream.status, 200); reader = stream.body.getReader();
        let buffer = '';
        async function until(predicate) {
            const timeout = setTimeout(() => streamAbort.abort(), 10000);
            try {
                while (true) {
                    const index = buffer.indexOf('\n\n');
                    if (index >= 0) {
                        const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
                        if (block.startsWith('data: ')) { const data = JSON.parse(block.slice(6)); if (predicate(data)) return data; }
                    } else { const chunk = await reader.read(); if (chunk.done) throw new Error('Stream closed'); buffer += Buffer.from(chunk.value).toString(); }
                }
            } finally { clearTimeout(timeout); }
        }
        assert.equal((await until(() => true)).mode, 'quiz');
        ws = new WebSocket(`ws://127.0.0.1:${apps.ports.admin}`);
        await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
        ws.send('3416\t1'); await until(d => d.quiz.yes === 1);
        ws.send('3416\t0'); await until(d => d.quiz.no === 1);
        assert.equal(await fixture.db.collection('Responses').countDocuments(), 0);
        assert.equal((await (await fetch(graphs + '/data')).json()).positiveResponses, 0);
        assert.equal((await post(display + lab + '/mode', { mode: 'feedback' }, cookie)).status, 200);
        ws.send('3416\t1'); await until(d => d.feedback.yes === 1);
        ws.send('3416\t0'); await until(d => d.feedback.no === 1);
        assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
        const analytics = await (await fetch(graphs + '/data?room=Lab%20301')).json();
        assert.equal(analytics.positiveResponses, 0); assert.equal(analytics.negativeResponses, 1);
        ws.send('3417\t2'); await until(d => d.helps.length === 1);
        assert.equal((await post(display + lab + '/issue', { tableID: 3417, issue: 'Others', remarks: '' }, cookie)).status, 400);
        assert.equal((await post(display + lab + '/issue', { tableID: 3417, issue: 'Others', remarks: 'Damaged cable' }, cookie)).status, 200);
        await until(d => d.unresolved.length === 1);
        ws.send('3417\t2'); ws.send('3417\t1');
        await new Promise(resolve => setTimeout(resolve, 200));
        assert.equal(await fixture.db.collection('Helps').countDocuments(), 0);
        assert.equal(await fixture.db.collection('Responses').countDocuments(), 1);
        const exported = await (await fetch(graphs + '/download-data')).json();
        assert.equal(exported.find(r => r.Source === 'UnresolvedHelps').Remarks, 'Damaged cable');
        await post(display + lab + '/mode', { mode: 'quiz' }, cookie);
        await post(display + lab + '/reset', {}, cookie);
        assert.equal((await until(d => d.mode === 'quiz' && d.quiz.total === 0)).feedback.total, 1);
        const logout = await post(display + '/logout', {}, cookie); assert.match(logout.headers.get('set-cookie'), /ss_seatmap=;/);
        assert.equal((await fetch(admin + '/get-records', { headers: { cookie: adminCookie } })).status, 200);
    } finally {
        streamAbort.abort(); if (reader) await reader.cancel().catch(() => {}); if (ws) ws.terminate();
        await apps?.close(); await fixture.close();
    }
});
