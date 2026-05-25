# displayHelp

Real-time lab help-request dashboard with a visual seat map. Shows which tables need help, lets TAs classify issues, and tracks unresolved problems — all auto-refreshing.

## Setup

```bash
cd Method3_MongoDBmethod/displayHelp
npm install
```

Requires a `.env` file at `Method3_MongoDBmethod/.env` with `MONGODB_URI`.

## Running

```bash
npm start        # or: node server.js
```

Runs on **http://localhost:4000**.

## Routes

| Route | Description |
|---|---|
| `/` | Lists all currently ongoing labs (from `Schedule` collection) |
| `/lab/:labID` | List view — help calls shown as chips |
| `/lab/:labID/map` | **Seat map view** — visual grid with pulsing seats |

The home page links to the map view by default. Both views have a toggle in the header to switch between **Map View** and **List View**. If no `SeatLayouts` document exists for a lab, the map route falls back to the list view.

## Seat Map Configuration

Layouts can be configured in two ways:

1. **Admin panel** (recommended) — Use the **Seat Layout Manager** in the admin dashboard (`admin/` service) to visually preview and save layouts.
2. **CLI script** — Use `insertSeatLayout.js` for batch/scripted setup.

```bash
node insertSeatLayout.js <labNo> <totalRows> <seatsPerRow> [oddRowPosition] [startTableID]
```

### Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `labNo` | Yes | — | Room name matching `Schedule.labNo` (e.g. `"Lab C11"`) |
| `totalRows` | Yes | — | Number of desk rows (perpendicular to the whiteboard) |
| `seatsPerRow` | Yes | — | Seats in each row (whiteboard → back wall) |
| `oddRowPosition` | No | `right` | `left` or `right` — which wall the unpaired row sits against (only matters when `totalRows` is odd) |
| `startTableID` | No | `1001` | First tableID; IDs are assigned row-major (row 0 gets the first N IDs, then row 1, etc.) |

### Examples

```bash
# 5 rows, 8 seats each, odd row against left wall, tableIDs start at 1001
node insertSeatLayout.js "Lab C11" 5 8 left 1001

# 6 rows, 10 seats each (even — no odd row issue), tableIDs start at 2001
node insertSeatLayout.js "Lab C12" 6 10 right 2001

# Defaults: oddRowPosition=right, startTableID=1001
node insertSeatLayout.js "Lab C13" 4 8
```

The script prints an ASCII preview of the grid before inserting. Safe to re-run — it upserts (overwrites existing layout for the same lab).

### Layout Logic

- Desk rows are **paired** (2 rows share a physical table/bench), with an aisle between each pair.
- When `totalRows` is odd, the unpaired row is placed against the wall specified by `oddRowPosition`.
- The **whiteboard** always appears at the top of the map.

### Seat States

| Color | Meaning |
|---|---|
| Grey | Idle — no active help request |
| Pulsing orange | Help requested — click to classify the issue |
| Red | Unresolved issue — shows issue category |

### MongoDB Document Schema (`SeatLayouts`)

```json
{
  "_id": "Lab C11",
  "totalRows": 5,
  "seatsPerRow": 8,
  "oddRowPosition": "left",
  "seats": [
    { "row": 0, "seat": 0, "tableID": 1001 },
    { "row": 0, "seat": 1, "tableID": 1002 },
    ...
  ]
}
```

## Related Services

| Service | Port | Purpose |
|---|---|---|
| `admin/` | 3000 | Schedule management, seat layout configuration, WebSocket handler |
| `graphs/` | 3010 | Data visualisation dashboard |
| `helpArchive/` | 4000 | Historical help records |
```