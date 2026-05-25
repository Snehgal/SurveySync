// button
document.getElementById('help-btn').onclick = function() {
    window.open('https://help-responses.onrender.com', '_blank');
};
document.getElementById('dshbrd').onclick = function() {
    window.open('https://dashboard-e9g1.onrender.com/', '_blank');
};
// Function to load room numbers into the dropdown
function loadRoomNumbers() {
    fetch('/get-room-numbers')
        .then(response => response.json())
        .then(roomNumbers => {
            console.log('Room numbers received:', roomNumbers); // Debugging line
            if (!Array.isArray(roomNumbers)) {
                throw new TypeError('Expected an array of room numbers');
            }
            const roomNumberSelect = document.getElementById('roomNumber');
            roomNumberSelect.innerHTML = ''; // Clear existing options
            roomNumbers.forEach(number => {
                const option = document.createElement('option');
                option.value = number;
                option.textContent = number;
                roomNumberSelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error loading room numbers:', error);
        });
}

// Toggle visibility of records
const dataHeading = document.getElementById('data-heading');
const dataContainerS = document.getElementById('data-containerS');
const toggleIndicator = document.getElementById('toggle-indicator');

dataHeading.addEventListener('click', function () {
    if (dataContainerS.style.display === 'none') {
        dataContainerS.style.display = 'block';
        toggleIndicator.textContent = '▼'; // Up arrow when expanded
    } else {
        dataContainerS.style.display = 'none';
        toggleIndicator.textContent = '▶'; // Down arrow when collapsed
    }
});

// Get modal elements
const modal = document.getElementById('myModal');
const span = document.getElementsByClassName('close')[0];
const modalMessage = document.getElementById('modalMessage');

// Function to show the modal with a message
function showModal(message) {
    modalMessage.textContent = message;
    modal.style.display = 'block';
}

// Close the modal when the user clicks on <span> (x)
span.onclick = function() {
    modal.style.display = 'none';
}

// Close the modal when the user clicks anywhere outside of the modal
window.onclick = function(event) {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
}

// Toggle repeat-until date picker visibility
document.getElementById('repeatWeekly').addEventListener('change', function () {
    const wrapper = document.getElementById('repeatUntilWrapper');
    wrapper.style.display = this.checked ? 'block' : 'none';
    if (!this.checked) {
        document.getElementById('repeatUntil').value = '';
    }
});

// Build array of weekly records
function buildRecords(courseCode, batch, labNumberStart, labNo, startTime, endTime, repeatWeekly, repeatUntil) {
    const records = [];
    let currentStart = new Date(startTime);
    let currentEnd = new Date(endTime);
    let labNum = parseInt(labNumberStart, 10);
    const until = repeatWeekly && repeatUntil ? new Date(repeatUntil) : null;

    while (true) {
        let labNumber = String(labNum).padStart(2, '0');
        const labID = courseCode + '-' + batch + '-' + labNumber;
        records.push({
            labID,
            labNo,
            startTime: currentStart.toISOString(),
            endTime: currentEnd.toISOString()
        });

        if (!until) break; // single record

        // Advance by 7 days
        currentStart = new Date(currentStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        currentEnd = new Date(currentEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
        labNum++;

        if (currentStart > until) break;
    }
    return records;
}

// Add new record(s)
document.getElementById('scheduleForm').addEventListener('submit', function (event) {
    event.preventDefault();

    // Get values from the form
    const courseCodeElem = document.getElementById('courseCode');
    const batchElem = document.getElementById('batch');
    const labNumberElem = document.getElementById('labNumber');
    const labNoElem = document.getElementById('roomNumber');
    const startTimeElem = document.getElementById('startTime');
    const endTimeElem = document.getElementById('endTime');
    const repeatWeeklyElem = document.getElementById('repeatWeekly');
    const repeatUntilElem = document.getElementById('repeatUntil');
    
    if (!courseCodeElem || !batchElem || !labNumberElem || !labNoElem || !startTimeElem || !endTimeElem) {
        console.error('One or more form elements are missing.');
        return;
    }

    const courseCode = courseCodeElem.value;
    const batch = batchElem.value;
    const labNumber = labNumberElem.value;
    const labNo = labNoElem.value;
    const startTime = startTimeElem.value;
    const endTime = endTimeElem.value;
    const repeatWeekly = repeatWeeklyElem.checked;
    const repeatUntil = repeatUntilElem.value;

    if (repeatWeekly && !repeatUntil) {
        showModal('Please select a "Repeat Until" date.');
        return;
    }

    const records = buildRecords(courseCode, batch, labNumber, labNo, startTime, endTime, repeatWeekly, repeatUntil);

    fetch('/add-schedule', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ records })
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            loadRecords();
            document.getElementById('scheduleForm').reset();
            document.getElementById('repeatUntilWrapper').style.display = 'none';
            showModal(result.message);
        } else {
            console.error('Failed to add record(s):', result.message);
            showModal('Failed: ' + result.message);
        }
    })
    .catch(error => {
        console.error('Error adding record:', error);
        showModal('Error adding record: ' + error.message);
    });
});

function adjustIST(date) {
    // // Convert UTC date to IST (UTC+5:30)
    const istOffset = 5 * 60 + 30; // IST is UTC+5:30
    return new Date(new Date(date).getTime() - istOffset * 60 * 1000);
    // return date;
}

// Current active tab
let activeTab = 'ongoing';

// Tab click handling
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        activeTab = this.dataset.tab;
        loadRecords(activeTab);
    });
});

// Load records from the server with a filter
function loadRecords(filter) {
    filter = filter || activeTab;
    const url = '/get-records?filter=' + encodeURIComponent(filter);
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(records => {
            const dataContainerS = document.getElementById('data-containerS');
            dataContainerS.innerHTML = '';

            if (records.length > 0) {
                // Create headings
                const headings = document.createElement('div');
                headings.classList.add('data-entry', 'headings');
                headings.innerHTML = `
                    <span>Sr. No</span>
                    <span>Lab ID</span>
                    <span>Room Number</span>
                    <span>Date</span>
                    <span>Start Time</span>
                    <span>End Time</span>
                `;
                dataContainerS.appendChild(headings);

                // Populate records
                records.forEach((record, index) => {
                    const entry = document.createElement('div');
                    entry.classList.add('data-entry', 'record');
                    entry.innerHTML = `
                        <span>${index + 1}</span>
                        <span>${record.labID}</span>
                        <span>${record.labNo}</span>
                        <span>${adjustIST(new Date(record.endTime)).toLocaleDateString({ weekday:"short", year: "numeric", month: "short", day: "numeric" })}</span>
                        <span>${adjustIST(new Date(record.startTime)).toLocaleTimeString()}</span>
                        <span>${adjustIST(new Date(record.endTime)).toLocaleTimeString()}</span>
                    `;
                    dataContainerS.appendChild(entry);
                });
            } else {
                dataContainerS.innerHTML = '<div class="no-records">No records found</div>';
            }
        })
        .catch(error => {
            console.error('Error loading records:', error);
        });
}

// Load room numbers and records on page load
window.onload = function () {
    loadRoomNumbers();
    loadRecords('ongoing');
    loadLayoutRoomNumbers();
};

// ═══════════════════════════════════════════════════
// ══  Seat Layout Manager
// ═══════════════════════════════════════════════════

function loadLayoutRoomNumbers() {
    fetch('/get-room-numbers')
        .then(r => r.json())
        .then(rooms => {
            const sel = document.getElementById('layoutRoom');
            // keep the placeholder
            sel.innerHTML = '<option value="">— Select Room —</option>';
            rooms.forEach(room => {
                const opt = document.createElement('option');
                opt.value = room;
                opt.textContent = room;
                sel.appendChild(opt);
            });
        })
        .catch(err => console.error('Error loading layout rooms:', err));
}

// When a room is selected, fetch its existing layout
document.getElementById('layoutRoom').addEventListener('change', function () {
    const room = this.value;
    const statusDiv = document.getElementById('layoutStatus');
    const existingPreview = document.getElementById('existingLayoutPreview');
    const previewArea = document.getElementById('layoutPreviewArea');
    const saveBtn = document.getElementById('saveLayoutBtn');

    // Reset
    existingPreview.style.display = 'none';
    existingPreview.innerHTML = '';
    previewArea.style.display = 'none';
    previewArea.innerHTML = '';
    saveBtn.style.display = 'none';

    if (!room) {
        statusDiv.innerHTML = '';
        return;
    }

    statusDiv.innerHTML = '<span style="color:#888;">Loading…</span>';

    fetch('/get-seat-layout/' + encodeURIComponent(room))
        .then(r => r.json())
        .then(data => {
            if (data.exists) {
                const layout = data.layout;
                statusDiv.innerHTML = '<span style="color:#28a745; font-weight:600;">✔ Layout exists</span>'
                    + ' &nbsp;|&nbsp; '
                    + '<span>' + layout.totalRows + ' rows × ' + layout.seatsPerRow + ' seats'
                    + (layout.oddRowPosition ? ' (odd row: ' + layout.oddRowPosition + ')' : '')
                    + '</span>';

                // Fill inputs with existing values
                document.getElementById('layoutRows').value = layout.totalRows;
                document.getElementById('layoutSeatsPerRow').value = layout.seatsPerRow;
                document.getElementById('layoutOddRow').value = layout.oddRowPosition || 'right';
                // Deduce startTableID from first seat
                const startID = layout.seats.length > 0 ? layout.seats[0].tableID : 1001;
                document.getElementById('layoutStartID').value = startID;

                // Show existing layout preview
                existingPreview.style.display = 'block';
                existingPreview.innerHTML = '<h3 style="color:#333; margin-bottom:8px;">Current Layout</h3>'
                    + buildGridPreviewHTML(layout.totalRows, layout.seatsPerRow, layout.oddRowPosition || 'right', startID);
            } else {
                statusDiv.innerHTML = '<span style="color:#dc3545; font-weight:600;">✘ NO LAYOUT ADDED</span>';
                // Clear inputs
                document.getElementById('layoutRows').value = '';
                document.getElementById('layoutSeatsPerRow').value = '';
                document.getElementById('layoutStartID').value = '';
            }
        })
        .catch(err => {
            console.error(err);
            statusDiv.innerHTML = '<span style="color:#dc3545;">Error fetching layout</span>';
        });
});

// ── Grid layout computation (mirrors server-side computeGridLayout) ──

function computeGridLayoutClient(totalRows, oddRowPosition) {
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

    let col = 1;
    const columnMap = {};
    const gridTemplateParts = [];

    groups.forEach((group, gi) => {
        group.forEach(r => {
            columnMap[r] = col;
            col++;
            gridTemplateParts.push('minmax(55px, 1fr)');
        });
        if (gi < groups.length - 1) {
            col++;
            gridTemplateParts.push('20px');
        }
    });

    return { columnMap, gridTemplate: gridTemplateParts.join(' '), totalGridCols: col - 1, groups };
}

function buildGridPreviewHTML(totalRows, seatsPerRow, oddRowPosition, startTableID) {
    const { columnMap, gridTemplate, groups } = computeGridLayoutClient(totalRows, oddRowPosition);

    // Build seats array (row-major)
    const seats = [];
    let tid = startTableID;
    for (let row = 0; row < totalRows; row++) {
        for (let seat = 0; seat < seatsPerRow; seat++) {
            seats.push({ row, seat, tableID: tid++ });
        }
    }

    let html = '';
    html += '<div class="layout-room-preview">';

    // Whiteboard
    html += '<div class="preview-whiteboard">WHITEBOARD</div>';

    // Grid
    html += '<div class="preview-grid" style="grid-template-columns: ' + gridTemplate + ';">';
    seats.forEach(s => {
        const gcol = columnMap[s.row];
        const grow = s.seat + 1;
        html += '<div class="preview-seat" style="grid-column:' + gcol + '; grid-row:' + grow + ';">'
            + s.tableID
            + '</div>';
    });
    html += '</div>'; // grid

    // Legend: groups
    html += '<div class="preview-legend">';
    groups.forEach((group, gi) => {
        const label = group.length === 1
            ? 'Row ' + group[0] + ' (solo)'
            : 'Rows ' + group[0] + '–' + group[1] + ' (pair)';
        html += '<span class="preview-group-label">' + label + '</span>';
        if (gi < groups.length - 1) html += '<span class="preview-aisle-label">aisle</span>';
    });
    html += '</div>';

    html += '</div>'; // room
    return html;
}

// Preview button
document.getElementById('previewLayoutBtn').addEventListener('click', function () {
    const totalRows = parseInt(document.getElementById('layoutRows').value, 10);
    const seatsPerRow = parseInt(document.getElementById('layoutSeatsPerRow').value, 10);
    const oddRowPosition = document.getElementById('layoutOddRow').value;
    const startTableID = parseInt(document.getElementById('layoutStartID').value, 10);

    if (isNaN(totalRows) || totalRows < 1) { showModal('Enter a valid total rows (≥ 1)'); return; }
    if (isNaN(seatsPerRow) || seatsPerRow < 1) { showModal('Enter a valid seats per row (≥ 1)'); return; }
    if (isNaN(startTableID) || startTableID < 1) { showModal('Enter a valid start table ID'); return; }

    const previewArea = document.getElementById('layoutPreviewArea');
    previewArea.style.display = 'block';
    previewArea.innerHTML = '<h3 style="color:#333; margin-bottom:8px;">Preview</h3>'
        + buildGridPreviewHTML(totalRows, seatsPerRow, oddRowPosition, startTableID);

    document.getElementById('saveLayoutBtn').style.display = 'inline-block';
});

// Save button
document.getElementById('saveLayoutBtn').addEventListener('click', function () {
    const room = document.getElementById('layoutRoom').value;
    if (!room) { showModal('Please select a room first.'); return; }

    const totalRows = parseInt(document.getElementById('layoutRows').value, 10);
    const seatsPerRow = parseInt(document.getElementById('layoutSeatsPerRow').value, 10);
    const oddRowPosition = document.getElementById('layoutOddRow').value;
    const startTableID = parseInt(document.getElementById('layoutStartID').value, 10);

    // Build seats array
    const seats = [];
    let tid = startTableID;
    for (let row = 0; row < totalRows; row++) {
        for (let seat = 0; seat < seatsPerRow; seat++) {
            seats.push({ row, seat, tableID: tid++ });
        }
    }

    const payload = {
        labNo: room,
        totalRows,
        seatsPerRow,
        oddRowPosition: totalRows % 2 === 1 ? oddRowPosition : null,
        seats
    };

    fetch('/save-seat-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(result => {
        if (result.success) {
            showModal(result.message);
            // Refresh the existing preview
            document.getElementById('layoutRoom').dispatchEvent(new Event('change'));
        } else {
            showModal('Error: ' + result.message);
        }
    })
    .catch(err => {
        console.error(err);
        showModal('Error saving layout');
    });
});