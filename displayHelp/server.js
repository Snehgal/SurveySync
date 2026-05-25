require('dotenv').config({ path: "../.env" });
const bodyParser = require('body-parser');
const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
const port = 4000;

const uri = process.env.MONGODB_URI;
const dbName = 'ResponseLogging';

app.set('view engine', 'ejs');

// Middleware for parsing request bodies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('public'));

let db;

async function connectToMongoDB() {
    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });
    try {
        await client.connect();
        db = client.db(dbName);
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB", error);
        throw error;
    }
}

function toIST(date) {
    // Convert UTC date to IST (UTC+5:30)
    const istOffset = 5 * 60 + 30; // IST is UTC+5:30
    return new Date(date.getTime() - istOffset * 60 * 1000);
}

function toIST2(date) {
    // Convert UTC date to IST (UTC+5:30)
    const istOffset = 5 * 60 + 30; // IST is UTC+5:30
    return new Date(date.getTime() + istOffset * 60 * 1000);
}

function updateIST(date) {
    // Convert UTC date to IST (UTC+5:30)
    const istOffset = 5 * 60 + 30; // IST is UTC+5:30
    return new Date(date.getTime() - istOffset * 60 * 1000);
}

/**
 * Computes the CSS grid column layout for a lab's seating arrangement.
 * Desk rows are paired (2 rows share a table), with aisles between pairs.
 * @param {number} totalRows - Total number of desk rows (perpendicular to whiteboard)
 * @param {string} oddRowPosition - 'left' or 'right': which wall the unpaired row touches
 * @returns {{ columnMap: Object, gridTemplate: string, totalGridCols: number }}
 */
function computeGridLayout(totalRows, oddRowPosition) {
    const groups = [];

    if (totalRows % 2 === 1) {
        if (oddRowPosition === 'left') {
            // Odd row against left wall, then pairs going right
            groups.push([0]);
            for (let i = 1; i < totalRows; i += 2) {
                groups.push([i, i + 1]);
            }
        } else {
            // Pairs from left, odd row against right wall
            for (let i = 0; i < totalRows - 1; i += 2) {
                groups.push([i, i + 1]);
            }
            groups.push([totalRows - 1]);
        }
    } else {
        // Even number of rows — all paired
        for (let i = 0; i < totalRows; i += 2) {
            groups.push([i, i + 1]);
        }
    }

    let col = 1;
    const columnMap = {};
    const gridTemplateParts = [];

    groups.forEach((group, gi) => {
        group.forEach(r => {
            columnMap[r] = col;
            col++;
            gridTemplateParts.push('minmax(60px, 1fr)');
        });
        // Add an aisle column between groups (but not after the last group)
        if (gi < groups.length - 1) {
            col++;
            gridTemplateParts.push('24px');
        }
    });

    return {
        columnMap,
        gridTemplate: gridTemplateParts.join(' '),
        totalGridCols: col - 1
    };
}

app.get('/', async (req, res) => {
try {
    const currentTime = toIST2(new Date());
    console.log('Current date and time in IST:', currentTime.toISOString());

    // Get ongoing schedules
    const ongoingSchedules = await db.collection('Schedule').find({
        startTime: { $lte: currentTime },
        endTime: { $gte: currentTime }
    }).toArray();

    console.log('Ongoing schedules:', ongoingSchedules);

    if (ongoingSchedules.length === 0) {
        console.log('No ongoing schedules found.');
    }

    // Extract labNumbers and labIDs
    const ongoingLabNumbers = ongoingSchedules
        .map(schedule => ({
            labID: schedule.labID,
            labNumber: schedule.labNo
        }))
        .sort((a, b) => {
            // Extract numeric part for sorting
            const labNumberA = a.labNumber.match(/\d+$/);
            const labNumberB = b.labNumber.match(/\d+$/);

            if (labNumberA && labNumberB) {
                return parseInt(labNumberA[0], 10) - parseInt(labNumberB[0], 10);
            }

            return a.labNumber.localeCompare(b.labNumber);
        }); // Sort room numbers

    console.log('Sorted lab numbers:', ongoingLabNumbers);

    res.render('index', { labs: ongoingLabNumbers });

} catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).send(error);
}
});

app.get('/lab/:labID', async (req, res) => {
    const { labID } = req.params;
    try {
        // Fetch unresolved helps for the specific labID
        const unresolvedHelps = await db.collection('UnresolvedHelps').find({
            labID: labID
        }).toArray();

        // Convert unresolvedHelps to IST
        const unresolvedHelpsInIST = unresolvedHelps.map(help => ({
            ...help,
            issueRaised: (new Date()) // Convert issueRaised to IST
        }));

        // Fetch active helps for the specific labID
        const helps = await db.collection('Helps').find({
            labID: labID,
            helpEnded: { $exists: false }
        }).toArray();

        // Convert helpStarted to IST for the specific lab
        const helpsInIST = helps.map(help => ({
            ...help,
            helpStarted: toIST(new Date(help.helpStarted))
        }));

        // Fetch the lab number
        const lab = await db.collection('Schedule').findOne({ labID: labID });
        const labNumber = lab ? lab.labNo : 'Unknown Lab Number';

        console.log('Helps for labID:', labID, helpsInIST);
        console.log('Unresolved Helps for labID:', labID, unresolvedHelpsInIST);

        res.render('lab', { labNumber, labID, helps:helpsInIST, UnresolvedHelps: unresolvedHelpsInIST });
    } catch (error) {
        console.error("Error fetching data:", error);
        res.status(500).send(error);
    }
});

app.get('/lab/:labID/map', async (req, res) => {
    const { labID } = req.params;
    try {
        // Look up the lab's room number
        const lab = await db.collection('Schedule').findOne({ labID: labID });
        const labNumber = lab ? lab.labNo : 'Unknown Lab';

        // Fetch the seat layout for this room
        const layout = await db.collection('SeatLayouts').findOne({ _id: labNumber });

        if (!layout) {
            // No layout configured — fall back to the list view
            return res.redirect(`/lab/${labID}`);
        }

        // Fetch active helps (no helpEnded)
        const helps = await db.collection('Helps').find({
            labID: labID,
            helpEnded: { $exists: false }
        }).toArray();

        // Fetch unresolved helps
        const unresolvedHelps = await db.collection('UnresolvedHelps').find({
            labID: labID
        }).toArray();

        // Build lookup maps by tableID
        const helpMap = new Map(helps.map(h => [h.tableID, h]));
        const unresolvedMap = new Map(unresolvedHelps.map(u => [u.tableID, u]));

        // Compute CSS grid column positions from the pairing layout
        const { columnMap, gridTemplate, totalGridCols } = computeGridLayout(
            layout.totalRows,
            layout.oddRowPosition || 'right'
        );

        // Merge seat positions with live help status
        const processedSeats = layout.seats.map(seat => {
            const tableID = seat.tableID;
            let status = 'idle';
            let helpData = null;

            if (helpMap.has(tableID)) {
                status = 'help';
                helpData = helpMap.get(tableID);
            } else if (unresolvedMap.has(tableID)) {
                status = 'unresolved';
                helpData = unresolvedMap.get(tableID);
            }

            const helpStarted = helpData?.helpStarted
                ? toIST(new Date(helpData.helpStarted))
                : null;

            return {
                tableID,
                displayID: tableID % 100,  // Show last 2 digits of table ID
                status,
                gridColumn: columnMap[seat.row],
                gridRow: seat.seat + 1,  // 1-indexed for CSS grid
                helpStarted: helpStarted ? helpStarted.toISOString() : null,
                helpTime: helpStarted ? helpStarted.toLocaleTimeString() : null,
                issue: helpData?.issue || null
            };
        }).sort((a, b) => a.gridRow - b.gridRow || a.gridColumn - b.gridColumn);

        res.render('labMap', {
            labNumber,
            labID,
            seats: processedSeats,
            gridTemplateColumns: gridTemplate,
            totalGridCols,
            seatsPerRow: layout.seatsPerRow,
            activeHelps: helps.length,
            unresolvedCount: unresolvedHelps.length
        });

    } catch (error) {
        console.error('Error fetching map data:', error);
        res.status(500).send(error);
    }
});

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

        const currentTime = toIST(new Date());
        console.log("Current Time: ");
        console.log(currentTime);

        const schedule = await db.collection('Schedule').findOne({
            labNo: labNo,
            startTime: { $lte: (currentTime) },
            endTime: { $gte: (currentTime) }
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

app.post('/log-issue', async (req, res) => {
    const { tableID, issue, time } = req.body;
    try {
        const labID = await getLabID(tableID); // Retrieve labID based on tableID
        
        // Prepare the new issue record
        const newIssue = {
            labID: labID,
            tableID: parseInt(tableID),
            issue,
            issueRaised: new Date(time)
        };
        console.log("Inseting unresolved:",newIssue);
        
        // Insert the new issue into UnresolvedHelps
        await db.collection('UnresolvedHelps').insertOne(newIssue);

        // Delete the corresponding record from Helps
        await db.collection('Helps').deleteOne({
            tableID: parseInt(tableID),
            helpEnded: { $exists: false }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error logging issue:", error);
        res.json({ success: false });
    }
});



// Connect to MongoDB and start the server
connectToMongoDB().then(() => {
    app.listen(port, () => {
        console.log(`Server is running on http://localhost:${port}`);
    });
}).catch(error => {
    console.error("Failed to start server due to MongoDB connection error", error);
});

// to run
// cd D:\Chirag\VSCode\GITI\Method3_MongoDBmethod\displayHelp       
// node server.js
