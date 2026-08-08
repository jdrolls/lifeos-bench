#!/bin/bash
# Detached overnight Phase-1 fleet runner. Gates on: (1) oauth token present,
# (2) start time reached. Logs to results/phase1/fleet.log. Resumable — Fleet.ts
# skips completed cells, so re-running after a crash is safe.
set -euo pipefail
cd "$(dirname "$0")/.."
TOKEN_FILE="sandboxes/_auth/oauth-token"
START_EPOCH="${FLEET_START_EPOCH:?set FLEET_START_EPOCH}"

if [ ! -s "$TOKEN_FILE" ]; then
  echo "$(date '+%F %T') ABORT: $TOKEN_FILE missing/empty — no auth, fleet not started" >> results/phase1/fleet.log
  exit 1
fi
NOW=$(date +%s)
if [ "$NOW" -lt "$START_EPOCH" ]; then
  sleep $(( START_EPOCH - NOW ))
fi
# GPT-engine cells need the codex command template; harmless for claude-engine cells.
export CODEX_RUN_CMD="${CODEX_RUN_CMD:-bun /Users/<REDACTED>/.claude/PAI/Tools/CodexExec.ts --model gpt-5.6-terra --sandbox workspace-write --cwd {workspace} --prompt-file {promptfile}}"
echo "$(date '+%F %T') fleet starting ($(bun tools/Fleet.ts --dry-run | wc -l | tr -d ' ') planned cells, concurrency from config)" >> results/phase1/fleet.log
bun tools/Fleet.ts >> results/phase1/fleet.log 2>&1
echo "$(date '+%F %T') fleet finished exit=$?" >> results/phase1/fleet.log
bun tools/Report.ts >> results/phase1/fleet.log 2>&1
echo "$(date '+%F %T') report generated" >> results/phase1/fleet.log
