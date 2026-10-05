const http = require('http');
const path = require('path');
const auth = require('../shared/seat-auth');

module.exports = function installAccess(app) {
    app.get('/login', (req, res) => {
        auth.noStore(res);
        if (auth.isAuthenticated(req)) return res.redirect('/');
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });
    app.post('/login', (req, res) => {
        auth.noStore(res);
        const expected = auth.credentials();
        if (req.body?.username !== expected.username || req.body?.password !== expected.password) {
            return res.status(401).json({ success: false, message: 'Invalid seat-map username or password.' });
        }
        res.cookie(auth.COOKIE, auth.issueToken(), { httpOnly: true, sameSite: 'lax', maxAge: auth.MAX_AGE });
        res.json({ success: true });
    });
    app.post('/logout', (req, res) => {
        res.clearCookie(auth.COOKIE);
        auth.noStore(res);
        res.json({ success: true });
    });
    app.use((req, res, next) => {
        auth.noStore(res);
        if (auth.isAuthenticated(req)) return next();
        if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ success: false, message: 'Please sign in to the seat map.' });
        res.redirect('/login');
    });
    // Same-origin browser API: the admin process remains the single input coordinator.
    app.use('/api', (req, res) => {
        const upstream = http.request({
            hostname: process.env.ADMIN_INTERNAL_HOST || '127.0.0.1',
            port: Number(process.env.ADMIN_PORT) || 4001,
            path: '/seat-api' + req.url, method: req.method,
            headers: { cookie: req.headers.cookie || '', 'Content-Type': 'application/json' }
        }, response => {
            res.status(response.statusCode);
            for (const key of ['content-type', 'cache-control', 'x-accel-buffering']) {
                if (response.headers[key]) res.setHeader(key, response.headers[key]);
            }
            res.flushHeaders();
            response.pipe(res);
            response.on('error', () => res.end());
        });
        upstream.on('error', () => {
            if (!res.headersSent) res.status(503).json({ message: 'The input service is unavailable. Check that the admin server is running.' });
            else res.end();
        });
        // SSE is intentionally long-lived; ordinary commands have a bounded timeout.
        if (!req.path.endsWith('/events')) upstream.setTimeout(10000, () => upstream.destroy());
        res.on('close', () => upstream.destroy());
        upstream.end(req.method === 'GET' ? undefined : JSON.stringify(req.body || {}));
    });
};
