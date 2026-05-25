# Graphs — SurveySync Data Visualization Dashboard

A web dashboard for visualizing feedback and help-request data collected by SurveySync. It connects to a MongoDB database, aggregates responses and help calls, and renders interactive charts with filtering and export capabilities.

## Features

- **Interactive Charts** — View data as Bar, Pie, or Doughnut charts (powered by Chart.js)
- **Dynamic Filters** — Filter by Room Number, Course Code, Batch, and Lab Number
- **Live Updates** — Charts re-render automatically when any filter is changed
- **Excel Export** — Download filtered records as an `.xlsx` file
- **Dark Theme** — Clean dark UI with Montserrat typography

## Tech Stack

| Layer    | Technology                     |
| -------- | ------------------------------ |
| Server   | Node.js, Express               |
| Database | MongoDB (via `mongodb` driver) |
| Views    | EJS templates                  |
| Charts   | Chart.js, chartjs-plugin-datalabels |
| Export   | SheetJS (xlsx)                 |

## Project Structure

```
graphs/
├── server.js            # Express server & API routes
├── package.json
├── public/
│   ├── scripts.js       # Client-side chart logic & fetch calls
│   └── styles.css       # Dark theme styles
└── views/
    └── index.ejs        # Dashboard HTML template
```

## Prerequisites

- **Node.js** (v18+)
- **MongoDB** instance (local or Atlas)
- A `.env` file in the parent directory (`Method3_MongoDBmethod/.env`) containing:
  ```
  MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<options>
  ```

## Setup

```bash
cd Method3_MongoDBmethod/graphs
npm install
node server.js
```

The server starts at **http://localhost:3010**.

## API Endpoints

### `GET /`

Renders the dashboard page. Populates filter dropdowns from the `Schedule` collection by extracting distinct rooms, courses, batches, and lab numbers.

### `GET /data`

Returns aggregated counts for charting.

**Query Parameters** (all optional):

| Param    | Description          |
| -------- | -------------------- |
| `room`   | Room number          |
| `course` | Course code          |
| `batch`  | Batch identifier     |
| `lab`    | Lab number           |

**Response:**

```json
{
  "positiveResponses": 42,
  "negativeResponses": 5,
  "resolvedHelps": 30,
  "unresolvedHelps": 8
}
```

### `GET /download-data`

Returns detailed records (same filters as `/data`) for Excel export.

**Response:** Array of record objects:

```json
[
  {
    "db": "Responses",
    "room": "A-101",
    "course": "CSE101",
    "batch": "B1",
    "lab": "L1",
    "response": true,
    "helpEnded": null
  }
]
```

## MongoDB Collections Used

| Collection        | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `Schedule`        | Maps `labID` → room number; provides filter options |
| `Responses`       | Stores positive/negative feedback responses |
| `Helps`           | Stores help requests (resolved if `helpEnded` exists) |
| `UnresolvedHelps` | Stores unresolved help requests          |

The `labID` format is `course-batch-lab` (e.g., `CSE101-B1-L3`).

## Related Services

| Service | Port | Purpose |
|---|---|---|
| `admin/` | 3000 | Schedule management, seat layout configuration, WebSocket handler |
| `displayHelp/` | 4000 | Real-time help-request display with seat map |
| `helpArchive/` | 4000 | Historical help records |