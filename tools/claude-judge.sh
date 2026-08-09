#!/bin/bash
# Claude-side judge for the cross-vendor pass: GPT-family cells must not be graded by GPT.
#
# ISOLATION IS LOAD-BEARING, NOT HYGIENE. A bare `claude -p` loads the operator's real
# ~/.claude install — CLAUDE.md and its @-imports of PRINCIPAL_IDENTITY / PROJECTS / TELOS.
# A judge with that in context does not just leak identity tokens into judge-grades.jsonl; it
# grades the WRONG PROFILE. The T5 personalization rubric asks whether a response cites the
# supplied profile, and an unisolated judge failed correct answers for citing the synthetic
# persona instead of the operator's real projects. Every judgment from that pass was void.
#
# So: HOME and CLAUDE_CONFIG_DIR both point at an empty scaffold-free config, giving the judge
# nothing but the prompt it is handed. Billing mirrors RunCell — subscription OAuth only,
# never --bare, CLAUDECODE unset so the nested-session guard does not refuse to start.
set -euo pipefail
PROMPT_FILE="$1"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
JUDGE_HOME="$REPO/sandboxes/_judge"
JUDGE_CONFIG="$JUDGE_HOME/.claude"

# Empty config: no CLAUDE.md, no imports, no skills, no hooks.
mkdir -p "$JUDGE_CONFIG"
[ -f "$JUDGE_CONFIG/settings.json" ] || printf '{}\n' > "$JUDGE_CONFIG/settings.json"
[ -f "$JUDGE_CONFIG/.claude.json" ] || printf '{"hasCompletedOnboarding": true}\n' > "$JUDGE_CONFIG/.claude.json"
if [ -f "$JUDGE_CONFIG/CLAUDE.md" ]; then
  echo "judge config is not scaffold-free: $JUDGE_CONFIG/CLAUDE.md exists" >&2
  exit 1
fi

# CWD is the second leak path, and empirically the stronger one: Claude Code derives context
# from the working directory, so invoking the judge from inside the operator's tree surfaced
# their real projects even with HOME and CLAUDE_CONFIG_DIR already redirected. Probe from the
# repo named "PAI, ralph-trades-v3, Beacon"; the identical probe from a neutral dir answered
# "NONE". Run from a scratch dir so the judge sees only its prompt.
TOKEN="$(cat "$REPO/sandboxes/_auth/oauth-token")"
PROMPT="$(cat "$PROMPT_FILE")"
JUDGE_CWD="$(mktemp -d)"
trap 'rm -rf "$JUDGE_CWD"' EXIT
cd "$JUDGE_CWD"
env -u CLAUDECODE -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  HOME="$JUDGE_HOME" \
  CLAUDE_CONFIG_DIR="$JUDGE_CONFIG" \
  CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" \
  claude -p "$PROMPT" --model claude-sonnet-5 --permission-mode bypassPermissions
