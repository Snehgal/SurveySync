    const express = require('express');
    const WebSocket = require('ws');
    const http = require('http');
    const bodyParser = require('body-parser');
    const os = require('os');
    const path = require('path');
    const crypto = require('crypto');
    const { MongoClient, ServerApiVersion } = require('mongodb');
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

    const app = express();
    const host = process.env.HOST || 'localhost';
    const port = Number(process.env.ADMIN_PORT) || 4001; // Single port for both HTTP and WebSocket

    const uri = process.env.MONGODB_URI;
    let client;
    let db;
    let runtime;
    const seatAuth = require('../shared/seat-auth');
    const { LabRuntime } = require('../shared/lab-runtime');
    const subscribers = new Map();

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server }); // Bind WebSocket to HTTP server

    // Middleware
    app.use(bodyParser.json());

    // ─────────────────────────────────────────────
    // Admin authentication (lab incharge only)
    // ─────────────────────────────────────────────
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'surveysync';
    const AUTH_COOKIE = 'ss_admin';
    const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours
    // Stable token derived from the credentials so restarts don't force a re-login
    const AUTH_TOKEN = crypto
        .createHash('sha256')
        .update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}:surveysync-admin-secret`)
        .digest('hex');

    function parseCookies(req) {
        const header = req.headers.cookie || '';
        return header.split(';').reduce((acc, part) => {
            const idx = part.indexOf('=');
            if (idx > -1) {
                const key = part.slice(0, idx).trim();
                const value = part.slice(idx + 1).trim();
                if (key) acc[key] = decodeURIComponent(value);
            }
            return acc;
        }, {});
    }

    function isAuthenticated(req) {
        return parseCookies(req)[AUTH_COOKIE] === AUTH_TOKEN;
    }

    // Prevent the browser from caching authenticated pages/data.
    // Without this, the back/forward cache can restore the dashboard after logout.
    function noStore(res) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }

    // Guard for protected API routes (used only by the authenticated admin UI)
    function requireAuth(req, res, next) {
        noStore(res);
        if (isAuthenticated(req)) return next();
        return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    // Serve the login page (publicly accessible)
    app.get('/login', (req, res) => {
        noStore(res);
        if (isAuthenticated(req)) return res.redirect('/');
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    });

    // Validate credentials and start a session
    app.post('/login', (req, res) => {
        const { username, password } = req.body || {};
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            res.cookie(AUTH_COOKIE, AUTH_TOKEN, {
                httpOnly: true,
                sameSite: 'lax',
                maxAge: SESSION_MAX_AGE
            });
            return res.json({ success: true });
        }
        return res.status(401).json({ success: false, message: 'Invalid username or password' });
    });

    // End the session
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE);
        res.json({ success: true });
    });

    // Gate the admin dashboard itself - unauthenticated users go to /login.
    // Served directly (not via static) with no-store so the browser's back/forward
    // cache can't restore it after logout.
    app.get(['/', '/index.html'], (req, res) => {
        noStore(res);
        if (!isAuthenticated(req)) return res.redirect('/login');
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.use(express.static(path.join(__dirname, 'public')));

    function toIST(date) {
        // // Convert UTC date to IST (UTC+5:30)
        const istOffset = 5 * 60 + 30; // IST is UTC+5:30
        return new Date(new Date(date).getTime() + istOffset * 60 * 1000);
        // return date;
    }

    async function getIPAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over internal (i.e. 127.0.0.1) and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
            }
        }
        }
        return '0.0.0.0';
    }

    // MongoDB Connection
    async function connectToMongoDB() {
        if (!client) {
            console.log("Connecting to MongoDB...");
            client = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });

            try {
                await client.connect();
                db = client.db(process.env.MONGODB_DB || "ResponseLogging");
                runtime = new LabRuntime(db, { onChange(snapshot) {
                    for (const res of subscribers.get(snapshot.labID) || []) {
                        res.write('data: ' + JSON.stringify(snapshot) + '\n\n');
                    }
                } });
                console.log("Connected to MongoDB");

                // Ensure indexes for faster lookups
                await db.collection('Tables').createIndex({ tableID: 1 });
                await db.collection('Schedule').createIndex({ labNo: 1, startTime: 1, endTime: 1 });

            } catch (error) {
                console.error("Error connecting to MongoDB", error);
                client = null;
                throw error;
            }
        }
    }

    // WebSocket Setup
    const clients = new Set();

    // Help starts are idempotent in the lab coordinator.
    /**
             * Broadcasts a message to all connected WebSocket clients.
             * @param {string} message - The message to send.
             */
    function broadcastToClients(message) {
        clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            } else {
                console.log('Skipping client as it is not open');
            }
        });
    }
    wss.on('connection', (ws) => {
        console.log('WebSocket client connected');
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        clients.add(ws);
        // broadcastToClients("New Client Added | Total = " + clients.size);

        ws.on('message', async (message) => {
            try {
                console.log('Received message:', message.toString());
                broadcastToClients('Received message:' + message.toString())
                // Ensure message is a string
                const messageStr = typeof message === 'string' ? message : message.toString();

                // Split message to extract tableID and value
                const values = messageStr.split('\t');
                if (values.length !== 2) {
                    console.error('Expected 2 values, but received:', values);
                    broadcastToClients(`Error: Expected 2 values but received ${values.join(', ')}`);
                    return;
                }

                const tableID = /^\d+$/.test(values[0].trim()) ? Number(values[0]) : NaN;
                const value = /^-?\d+$/.test(values[1].trim()) ? Number(values[1]) : NaN;

                if (tableID === 1111 && value === -1) {
                    console.log('ESP32 test signal received - device online');
                    broadcastToClients('ESP32_CONNECTED');
                    return;
                }

                if (isNaN(tableID) || isNaN(value)) {
                    console.error('One or more values could not be parsed as integers.');
                    broadcastToClients('Error: Invalid tableID or value received.');
                    return;
                }

                const result = await runtime.input(tableID, value);
                if (result.ignored) ws.send(result.reason);
                else if (value === 2) broadcastToClients('Help started for table ' + tableID);
                else if (value === 3) broadcastToClients('Help ended for table ' + tableID);

            } catch (error) {
                const errorMessage = `Error processing message: ${error.message || error}`;
                console.error(errorMessage);
                broadcastToClients(errorMessage);
            }
        });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            clients.delete(ws);
            // broadcastToClients("Client Disconnected | Total = " + clients.size);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(interval);
    });

    console.log(`WebSocket server running at ws://${host}:${port}/`);

    // The separate seat-map identity controls modes, issues and quiz totals.
    app.use('/seat-api', seatAuth.requireAuth);
    app.get('/seat-api/labs/:labID/events', async (req, res) => {
        const labID = req.params.labID;
        try {
            res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.flushHeaders();
            if (!subscribers.has(labID)) subscribers.set(labID, new Set());
            subscribers.get(labID).add(res);
            const heartbeat = setInterval(() => {
                if (!seatAuth.isAuthenticated(req)) return res.end();
                res.write(': heartbeat\n\n');
            }, 15000);
            res.on('close', () => {
                clearInterval(heartbeat);
                subscribers.get(labID)?.delete(res);
                if (!subscribers.get(labID)?.size) subscribers.delete(labID);
            });
            await runtime.serial(labID, async () => {
                const data = await runtime.snapshotUnlocked(await runtime.schedule(labID));
                res.write('data: ' + JSON.stringify(data) + '\n\n');
            });
        } catch (error) {
            res.write('event: failure\ndata: ' + JSON.stringify({ message: error.message }) + '\n\n');
            res.end();
        }
    });
    function seatRoute(action) {
        return async (req, res) => {
            try { res.json(await action(req)); }
            catch (error) { res.status(400).json({ success: false, message: error.message }); }
        };
    }
    app.get('/seat-api/labs/:labID/state', seatRoute(req => runtime.snapshot(req.params.labID)));
    app.post('/seat-api/labs/:labID/mode', seatRoute(req => runtime.setMode(req.params.labID, req.body.mode)));
    app.post('/seat-api/labs/:labID/reset', seatRoute(req => runtime.reset(req.params.labID)));
    app.post('/seat-api/labs/:labID/issue', seatRoute(req => runtime.issue(req.params.labID, req.body)));

    // Get schedule records with optional filter
    app.get('/get-records', requireAuth, async (req, res) => {
        try {
            await connectToMongoDB();
            const filter = req.query.filter || 'all';
            const now = toIST(new Date());
            let query = {};

            if (filter === 'ongoing') {
                // Labs where now is between startTime and endTime
                query = { startTime: { $lte: now }, endTime: { $gt: now } };
            } else if (filter === 'past') {
                // Labs that ended within the last 7 days
                const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                query = { endTime: { $lt: now, $gte: sevenDaysAgo } };
            } else if (filter === 'upcoming') {
                // Labs starting within the next 7 days
                const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                query = { startTime: { $gt: now, $lte: sevenDaysLater } };
            }
            // 'all' → empty query returns everything

            const records = await db.collection('Schedule').find(query).sort({ startTime: 1 }).toArray();
            res.json(records);
        } catch (error) {
            console.error('Error retrieving records:', error);
            res.status(500).send('Error retrieving records');
        }
    });

    // Endpoint to add record(s) to "Schedule" (supports bulk weekly repeat)
    app.post('/add-schedule', requireAuth, async (req, res) => {
        try {
            await connectToMongoDB(); // Ensure connection is established
            const { records } = req.body;

            if (!records || !Array.isArray(records) || records.length === 0) {
                return res.status(400).json({ success: false, message: 'No records provided' });
            }

            // Check for duplicate labIDs before inserting any
            const labIDs = records.map(r => r.labID);
            const existing = await db.collection('Schedule').find({ labID: { $in: labIDs } }).toArray();
            if (existing.length > 0) {
                const dupes = existing.map(e => e.labID).join(', ');
                return res.status(400).json({ success: false, message: `These labIDs already exist: ${dupes}` });
            }

            // Convert times to IST for each record
            const docs = records.map(record => {
                return {
                    ...record,
                    startTime: toIST(new Date(record.startTime)),
                    endTime: toIST(new Date(record.endTime))
                };
            });

            await db.collection('Schedule').insertMany(docs);
            const count = docs.length;
            res.status(200).json({ success: true, message: `${count} record${count > 1 ? 's' : ''} added successfully!` });
        } catch (error) {
            console.error('Error adding record(s):', error);
            res.status(500).json({ success: false, message: 'Error adding record(s)' });
        }
    });

    // Add this function to fetch unique room numbers from the "Schedule" collection
    app.get('/get-room-numbers', requireAuth, async (req, res) => {
        try {
            const collection = db.collection('Tables');
            // Use aggregation to get distinct '_id' values
            const roomNumbers = await collection.aggregate([
                { $group: { _id: "$_id" } },  // Group by '_id', which is the same as 'labNo'
                { $sort: { _id: 1 } }         // Sort by '_id'
            ]).toArray();

            // Map the result to get an array of room numbers
            const roomNumbersList = roomNumbers.map(item => item._id);
            res.json(roomNumbersList);
        } catch (error) {
            console.error('Error fetching room numbers:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Fetch existing seat layout for a room
    app.get('/get-seat-layout/:labNo', requireAuth, async (req, res) => {
        try {
            await connectToMongoDB();
            const labNo = req.params.labNo;
            const layout = await db.collection('SeatLayouts').findOne({ _id: labNo });

            if (layout) {
                res.json({ exists: true, layout });
            } else {
                res.json({ exists: false });
            }
        } catch (error) {
            console.error('Error fetching seat layout:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // Save (upsert) a seat layout for a room
    app.post('/save-seat-layout', requireAuth, async (req, res) => {
        try {
            await connectToMongoDB();
            const { labNo, totalRows, seatsPerRow, oddRowPosition, seats } = req.body;

            if (!labNo || !totalRows || !seatsPerRow || !seats || !Array.isArray(seats)) {
                return res.status(400).json({ success: false, message: 'Missing required fields' });
            }

            const doc = {
                _id: labNo,
                totalRows,
                seatsPerRow,
                oddRowPosition,
                seats
            };

            const result = await db.collection('SeatLayouts').replaceOne(
                { _id: labNo },
                doc,
                { upsert: true }
            );

            const action = result.upsertedCount > 0 ? 'created' : 'updated';
            res.json({ success: true, message: `Layout ${action} for "${labNo}".` });
        } catch (error) {
            console.error('Error saving seat layout:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    });

    // Start Server
    connectToMongoDB().then(() => {
        server.listen(port, () => {
        console.log(`Server running at http://${host}:${port}/`);
        });
        setInterval(() => runtime.tick(), 1000).unref();
    }).catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });

