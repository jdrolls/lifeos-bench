#!/bin/bash
# Detached overnight fleet runner. Gates on: (1) oauth token present, (2) start time reached,
# (3) containment clean after the run. Logs to results/phase1/fleet.log. Resumable — Fleet.ts
# skips cells whose meta.json says "success", so re-running after a crash is safe, and cells
# marked "contaminated" are retried rather than kept.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="sandboxes/_auth/oauth-token"
START_EPOCH="${FLEET_START_EPOCH:?set FLEET_START_EPOCH}"
LOG=results/phase1/fleet.log

if [ ! -s "$TOKEN_FILE" ]; then
  echo "$(date '+%F %T') ABORT: $TOKEN_FILE missing/empty — no auth, fleet not started" >> "$LOG"
  exit 1
fi
NOW=$(date +%s)
if [ "$NOW" -lt "$START_EPOCH" ]; then
  sleep $(( START_EPOCH - NOW ))
fi

# GPT-engine cells need a codex command template. No default is supplied on purpose: the
# previous default hardcoded an absolute path into the operator's private tree, which is
# both non-portable and a containment hazard in a repo intended for publication.
if [ -n "${CODEX_RUN_CMD:-}" ]; then
  export CODEX_RUN_CMD
fi

FLEET_ARGS=()
if [ -n "${FLEET_VERSIONS:-}" ]; then
  FLEET_ARGS=(--versions "$FLEET_VERSIONS")
fi
# A wave is (versions x models): Wave B and Wave C share versions and differ only by model.
if [ -n "${FLEET_MODELS:-}" ]; then
  FLEET_ARGS=(${FLEET_ARGS[@]+"${FLEET_ARGS[@]}"} --models "$FLEET_MODELS")
fi
# macOS ships bash 3.2, where expanding an EMPTY array under `set -u` is an "unbound variable"
# error. The ${A[@]+"${A[@]}"} form expands to nothing when unset instead of aborting the run.
PLANNED=$(bun tools/Fleet.ts --dry-run ${FLEET_ARGS[@]+"${FLEET_ARGS[@]}"} | wc -l | tr -d ' ')
echo "$(date '+%F %T') fleet starting ($PLANNED planned cells, concurrency from config)" >> "$LOG"
bun tools/Fleet.ts ${FLEET_ARGS[@]+"${FLEET_ARGS[@]}"} >> "$LOG" 2>&1
FLEET_EXIT=$?
echo "$(date '+%F %T') fleet finished exit=$FLEET_EXIT" >> "$LOG"

# Containment gate. Every cell is already checked inline by RunCell (which marks escapes
# "contaminated"), but this catches anything that landed outside a trial directory and gives
# one auditable verdict per fleet. A dirty fleet does NOT get a report — a report is a claim,
# and a claim built on cells that read outside their sandbox is exactly what this repo got
# wrong the first time.
if ! bun tools/LeakCheck.ts --root results >> "$LOG" 2>&1; then
  echo "$(date '+%F %T') CONTAINMENT FAILURE — report withheld, see LeakCheck output above" >> "$LOG"
  exit 2
fi
echo "$(date '+%F %T') containment clean" >> "$LOG"

bun tools/Report.ts >> "$LOG" 2>&1
echo "$(date '+%F %T') report generated" >> "$LOG"
