# Continuation slice A — fully implement tools/ (current files are STUBS)

Read SPEC.md sections 1–5 for the full contract. The six files in `tools/` exist but are
skeletal placeholders (220 lines total) — REPLACE their bodies with complete implementations.
Do NOT touch `fixtures/` (a separate slice owns it), `goldenset/goldenset.json`, or
`bench.config.json`.

Priorities and non-negotiables:
- `RunCell.ts`: real detached spawn (`setsid`, env scrub of ANTHROPIC_API_KEY /
  ANTHROPIC_AUTH_TOKEN / CLAUDECODE, never `--bare`), stream-json capture to
  transcript.jsonl, meta.json with tokens/wall-clock/exit, workspace-diff.txt via git.
- `Grade.ts`: every grader named in goldenset (regex, file_contains, file_not_contains,
  file_exists, file_exists_any, file_unchanged, workspace_diff_count, max_tool_calls,
  token_budget, command_exit0, command_output, command_output_matches_fixture,
  transcript_contains_command with before_first_edit, routing with null-marker skip).
- `StageVersion.ts`: RAW/L5/L6/L7 staging per SPEC.md incl. the containment scrub gate
  (grep the staged tree for the operator-identity tokens defined in `tools/LeakCheck.ts`
  → non-zero exit on hit; the literals live only in that file, never in documentation).
  Upstream layout note: the v7.28.3 checkout's install payload lives under
  `vendor/LifeOS/LifeOS/install/` — inspect it and map it to the sandbox config-dir shape.
- `Fleet.ts`: resume-safe, concurrency from config, `--dry-run` (exactly 144 runs,
  no header line miscounts), `--limit N`, one JSON progress line per completed run.
- Root `package.json` + `bun test` setup + unit tests for EVERY Grade.ts grader using
  temp-dir fixtures you create inside the tests.

Acceptance (run these, paste output in your report):
1. `bun test` → all green.
2. `bun tools/Fleet.ts --dry-run | wc -l` → 144.
3. `bun tools/StageVersion.ts RAW && ls sandboxes/RAW` → works.
4. `bun tools/StageVersion.ts L7 && grep -c ALGORITHM sandboxes/L7/CLAUDE.md` → ≥1.
