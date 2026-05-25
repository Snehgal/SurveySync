const express = require('express');
const WebSocket = require('ws');
const http = require('http'); // Added http module
const bodyParser = require('body-parser');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config({ path: "../.env" });

const app = express();
const port = 3000; // Port for the Express server
const wsPort = 8080; // Port for the WebSocket server

const uri = process.env.MONGODB_URI;

let client;
let db;
// let webSocketServer;

// Create an HTTP server
const server = http.createServer(app);

// Create a WebSocket server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections

function toIST(date) {
    // // Convert UTC date to IST (UTC+5:30)
    const istOffset = 5 * 60 + 30; // IST is UTC+5:30
    return new Date(new Date(date).getTime() + istOffset * 60 * 1000);
    // return date;
}

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

async function getLabID(tableID) {
    try {
        const roomPrefix = parseInt(tableID / 100, 10);
        if (isNaN(roomPrefix)) {
            throw new Error(`Invalid tableID: ${tableID}`);
        }

        const table = await db.collection('Tables').findOne({ tableID: roomPrefix });
        if (!table) {
            throw new Error(`No lab found for tableID: ${tableID}`);
        }

        const labNo = table._id;
        if (!labNo) {
            throw new Error(`Invalid labNo retrieved for tableID: ${tableID}`);
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

async function logToHelps(labID, tableID) {
    const helpLoggingCollection = db.collection('Helps');
    const latestRecord = await helpLoggingCollection.findOne(
        { labID: labID, tableID: tableID },
        { sort: { helpStarted: -1 } }
    );

    if (!latestRecord || latestRecord.helpEnded) {
        const helpLoggingDoc = {
            labID: labID,
            tableID: tableID,
            helpStarted: toIST(new Date())
        };
        try {
            await helpLoggingCollection.insertOne(helpLoggingDoc);
            console.log('Inserted new document into Helps');
        } catch (error) {
            console.error("Error inserting document into Helps", error);
        }
    } else {
        try {
            await helpLoggingCollection.updateOne(
                { _id: latestRecord._id },
                { $set: { helpEnded: toIST(new Date()) } }
            );
            console.log('Updated document in Helps with helpEnded');
        } catch (error) {
            console.error("Error updating document in Helps", error);
        }
    }
}

async function logToResponses(labID, tableID, value) {
    const responseLoggingCollection = db.collection('Responses');
    let nowDate=toIST(new Date());
    const responseLoggingDoc = {
        date: nowDate,
        response: value === 1
    };

    try {
        await responseLoggingCollection.updateOne(
            { labID: labID, date:nowDate, tableID: tableID },
            { $set: responseLoggingDoc },
            { upsert: true }
        );
        console.log('Updated or inserted document into Responses');
    } catch (error) {
        console.error("Error updating or inserting document into Responses", error);
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
// Middleware
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files from the "public" directory

// Endpoint to get current records from "Schedule"
app.get('/get-records', async (req, res) => {
    try {
        await connectToMongoDB(); // Ensure connection is established
        const records = await db.collection('Schedule').find({}).toArray();
        res.json(records);
    } catch (error) {
        res.status(500).send('Error retrieving records');
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


function setupWebSocketServer() {
    const wss = new WebSocket.Server({ port: wsPort });
    const clients = new Set(); // Using a Set to manage connected clients

    wss.on('connection', (ws) => {
        console.log('WebSocket client connected');
        clients.add(ws);

        ws.on('message', async (message) => {
            try {
                console.log('Received message:', message.toString());

                // Ensure message is a string
                const messageStr = typeof message === 'string' ? message : message.toString();

                // Split message to extract tableID and value
                const values = messageStr.split('\t');
                if (values.length !== 2) {
                    console.error('Expected 2 values, but received:', values);
                    return;
                }

                const tableID = parseInt(values[0].trim(), 10);
                const value = parseInt(values[1].trim(), 10);

                if (isNaN(tableID) || isNaN(value)) {
                    console.error('One or more values could not be parsed as integers.');
                    return;
                }

                const labID = await getLabID(tableID);

                if (value === 2) {
                    await logToHelps(labID, tableID);
                } else {
                    await logToResponses(labID, tableID, value);
                }

                // Send a confirmation message back to clients
                const messageToSend = `tableID: ${tableID}, value: ${value}`;
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(messageToSend);
                    } else {
                        console.log('Skipping client as it is not open');
                    }
                });
            } catch (error) {
                console.error('Error processing message:', error);
            }
        });

        ws.on('close', () => {
            console.log('WebSocket client disconnected');
            clients.delete(ws); // Remove client from Set
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    wss.on('error', (error) => {
        console.error('WebSocket Server Error:', error);
    });

    console.log(`WebSocket server running at ws://localhost:${wsPort}`);
}


// Endpoint to add a record to "Schedule"
app.post('/add-schedule', async (req, res) => {
    try {
        await connectToMongoDB(); // Ensure connection is established
        const record = req.body;

        // Parse startTime and endTime as Date objects and convert to IST
        const startTimeUTC = new Date(record.startTime);
        const endTimeUTC = new Date(record.endTime);

        const startTimeIST = toIST(startTimeUTC); // Convert to IST
        const endTimeIST = toIST(endTimeUTC);     // Convert to IST

        record.startTime = startTimeIST; // Store as IST Date object
        record.endTime = endTimeIST;     // Store as IST Date object

        // Check if a record with the same labID already exists
        const existingRecord = await db.collection('Schedule').findOne({ labID: record.labID });

        if (existingRecord) {
            // If a record exists, send an error response
            res.status(400).json({ message: 'Record with this labID already exists' });
        } else {
            // If no record exists, insert the new record
            await db.collection('Schedule').insertOne(record);
            res.status(200).json({ message: 'Record added successfully!' });
        }
    } catch (error) {
        res.status(500).send('Error adding record');
    }
});


app.listen(port, async () => {
    await connectToMongoDB(); // Ensure connection is established once at startup
    console.log(`Express server running at http://localhost:${port}`);
    // Uncomment if you want to empty collections
    // await emptyCollection("Helps");
    // await emptyCollection("Responses");
    setupWebSocketServer();
});

