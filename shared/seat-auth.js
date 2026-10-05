const crypto = require('crypto');

// Independent from the schedule administrator, including on the same hostname.
const COOKIE = 'ss_seatmap';
const MAX_AGE = 8 * 60 * 60 * 1000;
function credentials() {
    return {
        username: process.env.SEATMAP_USERNAME || 'labadmin',
        password: process.env.SEATMAP_PASSWORD || 'seatmap-local'
    };
}
function signature(value) {
    const { username, password } = credentials();
    return crypto.createHmac('sha256', `${username}:${password}:surveysync-seatmap`).update(value).digest('hex');
}
function issueToken() {
    const expires = String(Date.now() + MAX_AGE);
    return `${expires}.${signature(expires)}`;
}
function isAuthenticated(req) {
    const cookie = (req.headers.cookie || '').split(';').map(p => p.trim()).find(p => p.startsWith(`${COOKIE}=`));
    if (!cookie) return false;
    const [expires, supplied] = cookie.slice(COOKIE.length + 1).split('.');
    if (!/^\d+$/.test(expires) || Number(expires) <= Date.now() || !/^[a-f0-9]{64}$/.test(supplied || '')) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(signature(expires)));
}
function noStore(res) { res.set('Cache-Control', 'no-store, private'); }
function requireAuth(req, res, next) {
    noStore(res);
    if (isAuthenticated(req)) return next();
    res.status(401).json({ success: false, message: 'Please sign in to the seat map.' });
}
module.exports = { COOKIE, MAX_AGE, credentials, issueToken, isAuthenticated, noStore, requireAuth };
