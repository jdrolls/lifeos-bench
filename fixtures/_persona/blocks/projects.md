# Projects

Active projects only. Completed work is archived elsewhere.

---

## Batcomputer Telemetry Dashboard

- **Status:** Active — primary project
- **Supports:** G1
- **Stack:** Bun + TypeScript. Single static page, no framework.
- **Description:** One page showing live status for cave systems — power, mesh links,
  environmental sensors, vehicle bay. Replaces four separate terminal dashboards that
  nobody watches simultaneously.
- **Current focus:** sensor ingest is landing out of order under load; the page renders
  stale rows without saying they are stale.
- **Next actions:**
  - [ ] Timestamp every reading at ingest, not at render
  - [ ] Mark any panel older than 30s as stale in the UI
  - [ ] Move the mesh-link panel off polling and onto push
- **Blockers:** none — this is a time problem, not a technical one

## Grapnel Firmware Test Rig

- **Status:** Active
- **Supports:** G2
- **Stack:** Bun + TypeScript harness driving the launcher over serial.
- **Description:** Regression harness for launcher firmware. Replays 400 recorded field
  launches against a candidate build and reports failure-mode deltas.
- **Current focus:** the 0.8% failure rate clusters in cold-weather launches; the rig does
  not currently model temperature at all.
- **Next actions:**
  - [ ] Add temperature to the replay fixture format
  - [ ] Re-baseline against the last three firmware builds
- **Blockers:** need Lucius to sign off on the serial protocol change

## Applied Sciences Handoff

- **Status:** Planned — starts once G1 ships
- **Supports:** G4, P0
- **Description:** Document and transfer day-to-day Applied Sciences operations to Lucius.
  The blocker is not Lucius; the blocker is that nothing is written down.
