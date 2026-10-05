# Quiz, feedback and help tracking

Implemented against `vps-deploy`, starting at `05ec5ae`. Changes are local and uncommitted. Existing database data and the original Downloads/Blink32.ino were not modified during verification.

## Running locally

The existing three services still run separately, sharing the root `.env`:

```powershell
node admin/server.js
node displayHelp/server.js
node graphs/server.js
```

Run each in a separate terminal. Defaults are admin/input on 4001, seat map on 4000, and analytics on 3010. Existing environment overrides remain supported.

The seat-map login is independent from schedule administration. Local defaults:

- Username: `labadmin`
- Password: `seatmap-local`
- Override with `SEATMAP_USERNAME` and `SEATMAP_PASSWORD` in `.env`; restart both admin and displayHelp after changing these.
- Existing `ADMIN_USERNAME` / `ADMIN_PASSWORD` remain unchanged. The two roles use different cookies; logging out of one does not log out of the other.

`ADMIN_INTERNAL_HOST` defaults to `127.0.0.1`. The display service proxies authenticated requests and live server-sent events to the admin service. The browser no longer assumes a public port 4001 for the map. All three services support `MONGODB_DB`, defaulting to the original `ResponseLogging` database.

## Agreed behavior

- Each scheduled lab has its own mode and quiz votes. Default is Quiz, even without any page open.
- One latest Yes/No per table: a changed answer moves the vote between Yes and No; repeated identical inputs do not increase totals.
- Quiz votes live only in the single admin process's memory. Refresh, navigation, and mode changes preserve them. Reset clears that lab's quiz votes for every viewer. Process restart or session end clears quiz votes. They never enter `Responses`, analytics, or exports.
- Entering Feedback starts five minutes, capped by the scheduled lab end. Switching to Quiz ends collection early; entering Feedback again starts a fresh window. Clicking Feedback while it is already active does not restart the timer.
- Expiry automatically restores Quiz. Refresh, navigation, browser closure, and process restart do not restart the feedback deadline. Only mode/deadline metadata is stored in the new `LabModes` collection.
- Feedback keeps the latest response per `(labID, tableID)` across all windows in that lab. Prior feedback is retained when a new window starts and is displayed in Feedback mode. Quiz and Reset never erase it.
- Help-start and help-end work in both modes. Duplicate Help-start signals preserve the original wait time.
- Logging an issue uses one category: Faulty Equipment (remarks optional) or Others (nonblank remarks required). Remarks are limited to 1000 characters and appear in seat tooltips, list view, and analytics exports.
- Unresolved records take precedence over active help. All four device inputs from a frozen table are ignored for the rest of that scheduled lab. Existing recorded votes remain; freezing prevents subsequent inputs. The next scheduled lab starts unfrozen.
- Yellow is `< 7:00`; orange is `7:00 through exactly 15:00`; red is `> 15:00`. Existing shifted-IST storage is preserved; elapsed-time calculations subtract the stored offset before comparing with real time.
- Sessions use start-inclusive/end-exclusive boundaries. Ambiguous overlapping schedules for the same room reject input/mode changes instead of guessing a session. Correct the conflicting schedules before collecting responses.

## Implementation locations

- `shared/lab-runtime.js`: per-room input ordering, per-lab mutation serialization, quiz memory, feedback persistence, timer, freeze and validation.
- `shared/seat-auth.js`, `displayHelp/access.js`: independent seat-map credentials, signed eight-hour cookie, route guards and same-origin API/event proxy.
- `admin/server.js`: firmware WebSocket ingestion, authenticated lab control APIs and event streams.
- `displayHelp/public/live.js`, `live.css`, and view partials: animated graphs and mode styles, responsive map/list layouts, modal form, live updates and reconnect handling.
- `graphs/server.js`: existing analytics behavior plus remarks in exports.

No existing help/feedback history was migrated or cleared. The application adds no runtime package dependency; test-only dependencies are isolated under `tests`.

## Corrected firmware

Open `firmware/Blink32/Blink32.ino` in Arduino IDE. It preserves the supplied GPIO assignments and table IDs:

| Table | Red / No (0) | Help (2/3) | Green / Yes (1) |
|---|---|---|---|
| 3416 | GPIO 23 | GPIO 21 | GPIO 19 |
| 3417 | GPIO 27 | GPIO 12 | GPIO 13 |

The corrected copy removes out-of-bounds state indexing, samples/debounces momentary buttons independently, and uses nonblocking LED indication. Red/green emit on press, so release does not clear an answer. Help preserves press-to-start/release-to-end behavior. Offline votes are not replayed into a later mode; students must press again after reconnecting. Help state is reconciled when the connection returns.

The ESP32 must use the host computer's reachable LAN address, not `localhost`; the supplied address `192.168.3.176` and port 4001 are retained as configurable constants. No board has been flashed, and actual wiring/button behavior needs hardware verification.

## Verification and disposable preview

```powershell
npm.cmd install --prefix tests
npm.cmd test --prefix tests
npm.cmd run preview --prefix tests
```

Tests and preview start a temporary real MongoDB instance; they never connect to the `.env` database. First use downloads a MongoDB binary. The preview runs on `http://localhost:4400` with the local seat-map credentials above, using synthetic Lab 301 and Lab 302 sessions. Its input server is port 4401 and analytics is port 4310. Stop the preview with Ctrl+C to remove its temporary database.

15 automated checks pass: latest-vote semantics, duplicate/opposite events, isolation between labs, zero quiz database writes, timer boundaries/restart, Reset, issue validation, frozen inputs and next-session release, concurrency, metadata-write failure, actual HTTP/WebSocket/SSE flow, independent authentication, and analytics/export contents. Browser checks cover desktop/mobile rendering, live counts, Feedback refresh continuity, required remarks, issue submission, and shared list/map state.

Firmware compilation also passed for `esp32:esp32:esp32` with installed ESP32 core 3.3.11, WebSockets 2.7.2, and WiFiManager 2.0.17. It uses 1,183,799 bytes of flash (90% of the default application partition) and 47,864 bytes of global RAM (14%). This confirms the sketch builds for the generic ESP32 target; it does not verify the physical wiring or flash a device.

Completion status: all approved application changes are implemented and verified locally. No further product decisions are pending. The preview is disposable and uses sample data; VPS deployment and physical-device validation remain separate follow-up work.

## VPS handoff

VPS configuration remains deferred as requested. Deploy the shared directory together with all three services. Run exactly **one admin/input process**: quiz memory and mutation ordering are process-local. Before adding multiple workers, introduce a shared ephemeral coordinator. Configure the reverse proxy to stream `/api/.../events` without buffering, and configure the firmware's reachable input host/transport for the VPS. Production credentials and transport configuration should be set during that deployment.

Remaining physical verification: flash the corrected sketch to the intended ESP32, confirm red/green wiring, and exercise Help press/release, reconnect, vote changes, and frozen seats on the actual devices.

## UI refinement, October 2, 2026

Removed the redundant session/quiz labels, connection status text, reset confirmation text, analytics live badge, and decorative status dots. The map and list share a mode switch above the response graphs, with a sliding highlight and reduced-motion support. Room responses now have a transparent background with no surrounding border or shadow. The map banner reads Seat Map, and em dashes have been replaced throughout the project text.

Footers follow page content and reach the bottom of short pages, including both login pages. Verification: all 15 existing automated checks passed; browser checks covered desktop and mobile layouts, map/list navigation, live Yes/No counts, Reset without filler text, mode switching and countdown, help-form validation, analytics/admin cleanup, and footer placement. Changes remain local and uncommitted.

## Mode-switch race fix, October 5, 2026

Device inputs and operator mutations now enter a shared routing queue in the order received by the backend, before asynchronous table/session lookups. Once routed, each operation enters its existing per-lab queue; different labs can still process mutations concurrently. A later Quiz/Feedback switch or Reset cannot overtake an earlier input whose lookup is pending. Classification follows backend receipt order; the firmware does not timestamp physical presses.

Three regression checks first failed against the previous runtime, reproducing both mode-switch directions and Reset overtaking an input. After the fix, all 20 automated checks pass, including the existing real HTTP/WebSocket/SSE/database/analytics integration test, duplicate/opposite votes, timer expiry, frozen seats, mode persistence, and independent lab processing. Tests use disposable MongoDB and do not alter the configured application database.

This fix changes only the runtime ordering and adds regression coverage. Other audit findings remain outside this change. No VPS access, deployment, database migration, or firmware change was performed. The user will handle SSH and deployment. Restart the admin/input service after transferring the updated runtime; keep exactly one admin/input process. Deploy the full updated application, including the new shared directory and frontend files, because local uncommitted/untracked changes are not available through a VPS git pull yet.
