const express = require('express');
const { MongoClient } = require('mongodb');
const path = require('path');
const app = express();
require('dotenv').config({ path: "../.env" });

const uri = process.env.MONGODB_URI; // Use environment variable for URI
const dbName = 'ResponseLogging';
let db;

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

const client = new MongoClient(uri);

async function connectDB() {
    try {
        await client.connect();
        db = client.db(dbName);
        app.listen(3010, () => {
            console.log('Server is running on http://localhost:3010');
        });
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
        process.exit(1); // Exit process with failure
    }
}

connectDB();

app.get('/', async (req, res) => {
    try {
        // const rooms = await db.collection('Schedule').distinct('labNo');
        // const courses = await db.collection('Schedule').distinct('labID');

        // // Extract batches and labs and sort them
        // const batches = [...new Set(courses.map(course => course.split('-')[1]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        // const labs = [...new Set(courses.map(course => course.split('-')[2]))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        // // Sort rooms and courses
        // const sortedRooms = rooms.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        // const sortedCourses = courses.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        // return {
        //     rooms: sortedRooms,
        //     courses: sortedCourses,
        //     batches: batches,
        //     labs: labs
        // };
        const rooms = await db.collection('Schedule').distinct('labNo');
        const ids = await db.collection('Schedule').distinct('labID');
        const courses = [...new Set(ids.map(course => course.split('-')[0]))].sort();
        const batches = [...new Set(ids.map(course => course.split('-')[1]))].sort();
        const labs = [...new Set(ids.map(course => course.split('-')[2]))].sort();

        res.render('index', { rooms, courses, batches, labs });
    } catch (error) {
        console.error('Error fetching data for main page:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Build a list of matching labIDs based on filter criteria (room, course, batch, lab)
async function getMatchingLabIDs({ room, course, batch, lab }) {
    // Build a regex filter on labID in the Schedule collection
    const scheduleFilter = {};
    if (room) scheduleFilter.labNo = room;

    // Build regex for labID pattern: course-batch-lab
    const labIDParts = [
        course || '[^-]+',
        batch || '[^-]+',
        lab || '[^-]+'
    ];
    scheduleFilter.labID = { $regex: `^${labIDParts.join('-')}$` };

    const schedules = await db.collection('Schedule').find(scheduleFilter, { projection: { labID: 1 } }).toArray();
    return schedules.map(s => s.labID);
}

app.get('/data', async (req, res) => {
    try {
        const { room, course, batch, lab } = req.query;

        const matchingLabIDs = await getMatchingLabIDs({ room, course, batch, lab });

        // If filters are set but no labIDs match, return zeros immediately
        if ((room || course || batch || lab) && matchingLabIDs.length === 0) {
            return res.json({ positiveResponses: 0, negativeResponses: 0, resolvedHelps: 0, unresolvedHelps: 0 });
        }

        const labFilter = (room || course || batch || lab) ? { labID: { $in: matchingLabIDs } } : {};

        // Run all three collection queries in parallel
        const [trues, falses, resolvedCount, unresolvedHelpsCount, unresolvedInHelpsCount] = await Promise.all([
            db.collection('Responses').countDocuments({ ...labFilter, response: true }),
            db.collection('Responses').countDocuments({ ...labFilter, response: false }),
            db.collection('Helps').countDocuments({ ...labFilter, helpEnded: { $exists: true } }),
            db.collection('UnresolvedHelps').countDocuments(labFilter),
            db.collection('Helps').countDocuments({ ...labFilter, helpEnded: { $exists: false } })
        ]);

        const resolves = resolvedCount;
        const unresolves = unresolvedHelpsCount + unresolvedInHelpsCount;

        console.log("Requests:", room, course, batch, lab);
        console.log("Response:", trues, falses, resolves, unresolves);
        res.json({
            positiveResponses: trues,
            negativeResponses: falses,
            resolvedHelps: resolves,
            unresolvedHelps: unresolves
        });
    } catch (error) {
        console.error('Error processing data:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/download-data', async (req, res) => {
    try {
        const { room, course, batch, lab } = req.query;

        const matchingLabIDs = await getMatchingLabIDs({ room, course, batch, lab });

        if ((room || course || batch || lab) && matchingLabIDs.length === 0) {
            return res.json([]);
        }

        const labFilter = (room || course || batch || lab) ? { labID: { $in: matchingLabIDs } } : {};

        // Build a room lookup map from Schedule (one query instead of N)
        const schedules = await db.collection('Schedule').find({}, { projection: { labID: 1, labNo: 1 } }).toArray();
        const roomMap = {};
        for (const s of schedules) {
            roomMap[s.labID] = s.labNo;
        }

        function mapDoc(doc, dbName) {
            const [docCourse, docBatch, docLab] = doc.labID.split('-');

            const responseValue = doc.response === true
                ? 'YES'
                : doc.response === false
                    ? 'NO'
                    : 'HELP';

            return {
                Source: dbName,
                Room: roomMap[doc.labID] || null,
                Course: docCourse,
                Batch: docBatch,
                Lab: docLab,
                Response: responseValue,
                HelpEnded: doc.helpEnded || null,
                UnresolvedReason: dbName === 'UnresolvedHelps' ? (doc.issue || '') : ''
            };
        }

        // Fetch all three collections in parallel
        const [responses, helps, unresolvedHelps] = await Promise.all([
            db.collection('Responses').find(labFilter).toArray(),
            db.collection('Helps').find(labFilter).toArray(),
            db.collection('UnresolvedHelps').find(labFilter).toArray()
        ]);

        const records = [
            ...responses.map(doc => mapDoc(doc, 'Responses')),
            ...helps.map(doc => mapDoc(doc, 'Helps')),
            ...unresolvedHelps.map(doc => mapDoc(doc, 'UnresolvedHelps'))
        ];

        res.json(records);
    } catch (error) {
        console.error('Error fetching data for download:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Handle 404 errors
app.use((req, res) => {
    res.status(404).send('Page Not Found');
});

// Handle other types of errors
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).send('Internal Server Error');
});
