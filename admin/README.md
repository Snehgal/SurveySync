# SurveySync — Admin Panel

Admin server and dashboard for the SurveySync classroom feedback and help-request collection system.

## Overview

This module connects **ESP8266 hardware button devices** on lab tables to a **MongoDB backend** via **WebSocket**, and provides an admin web interface for managing lab schedules, monitoring activity, and viewing data.

## Architecture

```
ESP8266 buttons ──(WSS)──► Node.js server ──► MongoDB (ResponseLogging)
                                │
                          Admin Dashboard (browser)
```

## Features

### 1. Real-Time Feedback Collection
- ESP8266 devices send student responses over secure WebSocket (`wss://`)
- Each device supports 4 button inputs per board
- **Yes** (value `1`) / **No** (value `0`) — logged as survey responses
- **Help Request** (value `2`) — toggles a help request on/off with timestamps

### 2. Schedule Management
- Add lab sessions with course code, batch, lab number, room number, and time range
- **Repeat Weekly** — optionally repeat a schedule weekly up to a given date, auto-incrementing the lab number each week
- Duplicate `labID` detection prevents conflicting entries

### 3. Schedule Display (Tabbed View)
Four tabs filter the schedule records:
| Tab | Shows |
|-----|-------|
| **Ongoing** | Labs happening right now (`startTime ≤ now ≤ endTime`) |
| **Past (7 days)** | Labs that ended within the last 7 days |
| **Upcoming (7 days)** | Labs starting within the next 7 days |
| **All** | Every schedule record |

### 4. Live Activity Monitor
- WebSocket-based live feed of all incoming ESP8266 messages
- Connect/disconnect controls for the admin client
- Broadcasts status updates (client count, errors, inserts) to all connected admin clients

### 5. Seat Layout Manager
- Select a lab room from a dropdown
- If a layout exists, see the current grid preview (whiteboard, paired rows, aisles)
- If no layout exists, see a clear **"NO LAYOUT ADDED"** indicator
- Configure: total rows, seats per row, odd-row wall position, starting table ID
- **Preview** the grid before saving
- **Confirm & Save** upserts the `SeatLayouts` document — the displayHelp seat map picks it up immediately

### 6. External Links
- Links to Help-Tracking and Data Visualisation dashboards

## MongoDB Collections

| Collection | Purpose |
|------------|---------|
| `Tables` | Maps physical table IDs → room numbers |
| `Schedule` | Lab session timetable (labID, room, start/end times) |
| `Responses` | Student yes/no feedback per table per lab |
| `Helps` | Help request start/end timestamps per table per lab || `SeatLayouts` | Seat grid configuration per lab room (rows, seats, positions) |
## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the admin dashboard (static) |
| `GET` | `/get-records?filter=<tab>` | Returns schedule records; filter: `ongoing`, `past`, `upcoming`, or `all` |
| `GET` | `/get-room-numbers` | Returns distinct room numbers from the `Tables` collection |
| `POST` | `/add-schedule` | Adds one or more schedule records; body: `{ records: [...] }` |
| `GET` | `/get-seat-layout/:labNo` | Returns the seat layout for a room (`{ exists, layout }`) |
| `POST` | `/save-seat-layout` | Upserts a `SeatLayouts` document; body: `{ labNo, totalRows, seatsPerRow, oddRowPosition, seats }` |

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express + `ws` (WebSocket)
- **Database:** MongoDB (via official driver)
- **Hardware:** ESP8266 with WiFiManager, connects over WSS (port 443)
- **Config:** `dotenv` (reads `../.env` for `MONGODB_URI`)
- **Hosting:** Render (`esp8266-control.onrender.com`)

## Setup

```bash
# Install dependencies
npm install

# Ensure ../.env contains MONGODB_URI
# Start the server
npm start
```

The server runs on port **3000**, serving both HTTP and WebSocket on the same port.

## File Structure

```
admin/
├── server.js            # Express + WebSocket server, MongoDB logic
├── package.json
├── ESP8266_Code.cpp     # Arduino firmware for the button hardware
├── public/
│   ├── index.html       # Admin dashboard UI
│   ├── script.js        # Client-side logic (tabs, forms, WebSocket)
│   └── styles.css       # Styling
└── README.md
```
