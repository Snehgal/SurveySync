/**
 * insertSeatLayout.js
 *
 * Inserts a SeatLayouts document into MongoDB for a given lab room.
 *
 * Usage:
 *   node insertSeatLayout.js <labNo> <totalRows> <seatsPerRow> [oddRowPosition] [startTableID]
 *
 * Arguments:
 *   labNo            – Room name matching Schedule.labNo (e.g. "Lab C11")
 *   totalRows        – Number of desk rows (perpendicular to the whiteboard)
 *   seatsPerRow      – Number of seats in each row (front to back)
 *   oddRowPosition   – 'left' or 'right' (default: 'right')
 *                      Which wall the unpaired row sits against when totalRows is odd
 *   startTableID     – First tableID in this lab (default: 1001)
 *                      IDs are assigned row-major: row 0 gets first seatsPerRow IDs, etc.
 *
 * Examples:
 *   node insertSeatLayout.js "Lab C11" 5 8 left 1001
 *   node insertSeatLayout.js "Lab C12" 6 10 right 2001
 *   node insertSeatLayout.js "Lab C13" 4 8
 */

require('dotenv').config({ path: '../.env' });
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = 'ResponseLogging';

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.log(`
Usage:  node insertSeatLayout.js <labNo> <totalRows> <seatsPerRow> [oddRowPosition] [startTableID]

  labNo            Room name (e.g. "Lab C11")
  totalRows        Desk rows perpendicular to the whiteboard
  seatsPerRow      Seats per row (whiteboard → back wall)
  oddRowPosition   'left' or 'right' (default: 'right')
  startTableID     First tableID (default: 1001)

Example:
  node insertSeatLayout.js "Lab C11" 5 8 left 1001
`);
        process.exit(1);
    }

    const labNo           = args[0];
    const totalRows       = parseInt(args[1], 10);
    const seatsPerRow     = parseInt(args[2], 10);
    const oddRowPosition  = (args[3] || 'right').toLowerCase();
    const startTableID    = parseInt(args[4] || '1001', 10);

    // ── Validate inputs ──
    if (isNaN(totalRows) || totalRows < 1) {
        console.error('Error: totalRows must be a positive integer.');
        process.exit(1);
    }
    if (isNaN(seatsPerRow) || seatsPerRow < 1) {
        console.error('Error: seatsPerRow must be a positive integer.');
        process.exit(1);
    }
    if (!['left', 'right'].includes(oddRowPosition)) {
        console.error("Error: oddRowPosition must be 'left' or 'right'.");
        process.exit(1);
    }
    if (isNaN(startTableID)) {
        console.error('Error: startTableID must be a number.');
        process.exit(1);
    }

    // ── Generate seat entries (row-major) ──
    const seats = [];
    let tableID = startTableID;

    for (let row = 0; row < totalRows; row++) {
        for (let seat = 0; seat < seatsPerRow; seat++) {
            seats.push({ row, seat, tableID });
            tableID++;
        }
    }

    const doc = {
        _id: labNo,
        totalRows,
        seatsPerRow,
        oddRowPosition: totalRows % 2 === 1 ? oddRowPosition : null,
        seats
    };

    // ── Preview ──
    console.log('\n=== Seat Layout Preview ===');
    console.log(`Lab:             ${labNo}`);
    console.log(`Total rows:      ${totalRows}`);
    console.log(`Seats per row:   ${seatsPerRow}`);
    console.log(`Total seats:     ${seats.length}`);
    console.log(`TableID range:   ${startTableID} – ${tableID - 1}`);
    if (totalRows % 2 === 1) {
        console.log(`Odd row on:      ${oddRowPosition} wall`);
    }

    // Print a visual grid (rows as columns, seats as rows — matches the map orientation)
    console.log('\nGrid layout (whiteboard at top):\n');

    // Build group structure for display
    const groups = [];
    if (totalRows % 2 === 1) {
        if (oddRowPosition === 'left') {
            groups.push([0]);
            for (let i = 1; i < totalRows; i += 2) groups.push([i, i + 1]);
        } else {
            for (let i = 0; i < totalRows - 1; i += 2) groups.push([i, i + 1]);
            groups.push([totalRows - 1]);
        }
    } else {
        for (let i = 0; i < totalRows; i += 2) groups.push([i, i + 1]);
    }

    // Print header
    console.log('        ╔' + '═'.repeat(groups.length * 16 - 1) + '╗');
    const wbText = ' WHITEBOARD ';
    const wbPad = groups.length * 16 - 1;
    const wbLeft = Math.floor((wbPad - wbText.length) / 2);
    const wbRight = wbPad - wbText.length - wbLeft;
    console.log('        ║' + ' '.repeat(wbLeft) + wbText + ' '.repeat(wbRight) + '║');
    console.log('        ╚' + '═'.repeat(groups.length * 16 - 1) + '╝');

    for (let s = 0; s < seatsPerRow; s++) {
        let line = `Seat ${String(s + 1).padStart(2)}  `;
        groups.forEach((group, gi) => {
            group.forEach(r => {
                const seatObj = seats.find(se => se.row === r && se.seat === s);
                line += `[${String(seatObj.tableID).padStart(5)}] `;
            });
            if (gi < groups.length - 1) {
                line += '  ║  '; // aisle
            }
        });
        console.log(line);
    }
    console.log();

    // ── Insert into MongoDB ──
    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        }
    });

    try {
        await client.connect();
        const db = client.db(dbName);

        // Upsert: replace if already exists
        const result = await db.collection('SeatLayouts').replaceOne(
            { _id: labNo },
            doc,
            { upsert: true }
        );

        if (result.upsertedCount > 0) {
            console.log(`✔ Inserted new layout for "${labNo}".`);
        } else {
            console.log(`✔ Updated existing layout for "${labNo}".`);
        }
    } catch (error) {
        console.error('Error inserting layout:', error);
        process.exit(1);
    } finally {
        await client.close();
    }
}

main();
