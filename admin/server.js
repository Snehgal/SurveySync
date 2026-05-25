    const express = require('express');
    const WebSocket = require('ws');
    const http = require('http');
    const bodyParser = require('body-parser');
    const os = require('os');
    const { MongoClient, ServerApiVersion } = require('mongodb');
    require('dotenv').config({ path: "../.env" });

    const app = express();
    const port = 4001; // Single port for both HTTP and WebSocket

    const uri = process.env.MONGODB_URI;
    let client;
    let db;

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server }); // Bind WebSocket to HTTP server

    // Middleware
    app.use(bodyParser.json());
    app.use(express.static('public'));

    async function getLabID(tableID) {
        try {
            // Extract room prefix from tableID (e.g., 3201 -> 32)
            const roomPrefix = parseInt(tableID / 100, 10);
            if (isNaN(roomPrefix)) {
                throw new Error(`Invalid tableID: ${tableID}`);
            }

            // Find room that has this prefix in its tableID array
            const table = await db.collection('Tables').findOne({ tableID: roomPrefix });
            if (!table) {
                throw new Error(`No lab found for table prefix: ${roomPrefix}`);
            }

            const labNo = table._id;
            if (!labNo) {
                throw new Error(`Invalid labNo retrieved for table prefix: ${roomPrefix}`);
            }

            const currentTime = new Date();

            const schedule = await db.collection('Schedule').findOne({
                labNo: labNo,
                startTime: { $lte: toIST(currentTime) },
                endTime: { $gte: toIST(currentTime) }
            });

            if (!schedule) {
                throw new Error(`No active lab found for labNo: ${labNo}`);
            }

            return schedule.labID;

        } catch (error) {
            console.error("Error in getLabID:", error);
            throw error;
        }
    }

    async function logHelpStart(labID, tableID) {
        const helpLoggingCollection = db.collection('Helps');
        const helpLoggingDoc = {
            labID: labID,
            tableID: tableID,
            helpStarted: toIST(new Date())
        };
        try {
            await helpLoggingCollection.insertOne(helpLoggingDoc);
            console.log('Inserted new document into Helps (help started)');
            broadcastToClients('Help started for table ' + tableID);
        } catch (error) {
            console.error("Error inserting document into Helps", error);
            broadcastToClients("Error inserting document into Helps" + error);
        }
    }

    async function logHelpEnd(labID, tableID) {
        const helpLoggingCollection = db.collection('Helps');
        
        try {
            // Find the latest help record that hasn't ended yet
            const latestRecord = await helpLoggingCollection.findOne(
                { labID: labID, tableID: tableID, helpEnded: { $exists: false } },
                { sort: { helpStarted: -1 } }
            );
            
            if (latestRecord) {
                // Help exists and hasn't ended, so mark it as ended
                await helpLoggingCollection.updateOne(
                    { _id: latestRecord._id },
                    { $set: { helpEnded: toIST(new Date()) } }
                );
                console.log('Updated document in Helps with helpEnded for table ' + tableID);
                broadcastToClients('Help ended for table ' + tableID);
            } else {
                // No active help found, ignore the end signal
                console.log('No active help found for table ' + tableID + ', ignoring end signal');
                broadcastToClients('No active help found for table ' + tableID + ', ignoring end signal');
            }
        } catch (error) {
            console.error("Error ending help for table " + tableID, error);
            broadcastToClients("Error ending help for table " + tableID + ": " + error);
        }
    }

    async function logToResponses(labID, tableID, value) {
        if(value != 0 && value!=1){
            console.log('Value not defined',value);
            broadcastToClients('Value ' +value+" not defined");
            return;
        }
        const responseLoggingCollection = db.collection('Responses');
        let nowDate=toIST(new Date());
        const responseLoggingDoc = {
            date: nowDate,
            response: value === 1
        };

        try {
            await responseLoggingCollection.updateOne(
                { labID: labID, tableID: tableID },
                { $set: responseLoggingDoc },
                { upsert: true }
            );
            const responseLabel = value === 1 ? 'Yes' : 'No';
            console.log('Logged "' + responseLabel + '" successfully for table ' + tableID);
            broadcastToClients('Logged "' + responseLabel + '" successfully for table ' + tableID);
        } catch (error) {
            console.error("Error updating or inserting document into Responses", error);
            broadcastToClients("Error updating or inserting document into Responses" + error);
        }
    }

    async function emptyCollection(collectionName) {
        try {
            const collection = db.collection(collectionName);
            const result = await collection.deleteMany({});
            console.log(`Deleted ${result.deletedCount} documents from the ${collectionName} collection`);
        } catch (error) {
            console.error(`Error emptying the ${collectionName} collection`, error);
        }
    }

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
                db = client.db("ResponseLogging");
                console.log("Connected to MongoDB");

                // Ensure indexes for faster lookups
                await db.collection('Tables').createIndex({ tableID: 1 });
                await db.collection('Schedule').createIndex({ labNo: 1, startTime: 1, endTime: 1 });

            } catch (error) {
                console.error("Error connecting to MongoDB", error);
                throw error;
            }
        }
    }

    // WebSocket Setup
    const clients = new Set();
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
        clients.add(ws);
        broadcastToClients("New Client Added | Total = " + clients.size);

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
        
                const tableID = parseInt(values[0].trim(), 10);
                const value = parseInt(values[1].trim(), 10);
        
                if (isNaN(tableID) || isNaN(value)) {
                    console.error('One or more values could not be parsed as integers.');
                    broadcastToClients('Error: Invalid tableID or value received.');
                    return;
                }
        
                const labID = await getLabID(tableID);
        
                if (value === 2) {
                    // Signal 2: Help starts
                    await logHelpStart(labID, tableID);
                } else if (value === 3) {
                    // Signal 3: Help ends
                    await logHelpEnd(labID, tableID);
                } else {
                    // Other signals: Log responses
                    await logToResponses(labID, tableID, value);
                }
        
            } catch (error) {
                const errorMessage = `Error processing message: ${error.message || error}`;
                console.error(errorMessage);
                broadcastToClients(errorMessage);
            }
        });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            broadcastToClients("Client Disconnected | Total = " + clients.size);
            clients.delete(ws);
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    console.log(`WebSocket server running at wss://esp8266-control.onrender.com/`);

    // Get schedule records with optional filter
    app.get('/get-records', async (req, res) => {
        try {
            await connectToMongoDB();
            const filter = req.query.filter || 'all';
            const now = toIST(new Date());
            let query = {};

            if (filter === 'ongoing') {
                // Labs where now is between startTime and endTime
                query = { startTime: { $lte: now }, endTime: { $gte: now } };
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
    app.post('/add-schedule', async (req, res) => {
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
    app.get('/get-room-numbers', async (req, res) => {
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
    app.get('/get-seat-layout/:labNo', async (req, res) => {
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
    app.post('/save-seat-layout', async (req, res) => {
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
    server.listen(port, async () => {
        await connectToMongoDB();
        console.log(`Server running at https://esp8266-control.onrender.com/`);
        // Uncomment if you want to empty collections
        // await emptyCollection("Helps");
        // await emptyCollection("Responses");
        // await emptyCollection("UnresolvedHelps");
    });

