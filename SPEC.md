# lifeos-bench — Build Spec (Phase 0 harness)

You are building the execution harness for an AI-scaffolding benchmark. The golden set
(`goldenset/goldenset.json`) and matrix (`bench.config.json`) are FROZEN inputs — read them,
never modify them. All code is TypeScript on Bun. No npm/npx — bun/bunx only.

## Deliverables

### 1. `tools/StageVersion.ts`
Stages a scaffolding version into `sandboxes/<VERSION_ID>/`:
- `RAW`: create empty config dir with minimal settings.json (no CLAUDE.md, no hooks).
- `L7` (upstream): copy from `vendor/LifeOS/` checkout (already cloned at the right tag by the
  orchestrator) into the sandbox config-dir layout the version expects. Overlay synthetic user
  files from `fixtures/_synthetic-user/` (create these: a fake TELOS.md, fake identity files
  matching upstream's documented USER/ shape — invented person "Alex Doe", no real data).
- `FORK`: **retired from the published matrix.** The staging path remains available behind
  `--fork-src` for local experiments, but no fork lane is benchmarked or reported.
- Containment scrub gate: refuse to stage if the result contains any operator-identity
  token. The token list is the single source of truth in `tools/LeakCheck.ts`, assembled
  from fragments at runtime — do NOT restate the literals in documentation, or the docs
  become the leak the gate exists to prevent.
- Idempotent; `--force` re-stages.

### 2. `tools/RunCell.ts`
Runs one (version, model, prompt, trial):
- Creates a fresh workspace: copies `fixtures/<fixture>/` if the prompt has one, else empty dir.
- Launches headless: `claude -p "<prompt>" --model <cli_arg> --output-format stream-json` with
  `CLAUDE_CONFIG_DIR=<sandbox>`, cwd=workspace, **detached via setsid**, env scrubbed:
  delete `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE`. Never pass `--bare`.
- Captures: full stream-json transcript, final message, exit code, wall-clock, token usage
  (from the result event), and the post-run workspace state.
- Writes `results/phase1/<VERSION>/<model>/<prompt-id>/trial-<n>/{transcript.jsonl,meta.json,workspace-diff.txt}`.
- Timeout from config; on timeout record `status: "timeout"`, never retry silently.

### 3. `tools/Grade.ts`
Implements the code graders referenced in the golden set:
`regex`, `file_contains`, `file_not_contains`, `file_exists`, `file_exists_any`, `file_unchanged`,
`workspace_diff_count`, `max_tool_calls`, `token_budget`, `command_exit0`, `command_output`,
`command_output_matches_fixture`, `transcript_contains_command` (with `before_first_edit` support),
and `routing` (match the version's `routing_markers` from bench.config.json against the transcript;
emit `skipped` for RAW where markers are null).
Judge graders (`judge:rubric`) are STUBS here: emit `{status:"pending_judge"}` rows — the
orchestrator runs cross-vendor judges separately. Write per-trial grade rows to
`results/phase1/grades.jsonl` (one JSON object per grader per trial: run id fields, grader name,
pass/fail/skipped/pending, detail).

### 4. `tools/Fleet.ts`
Reads both config files, enumerates Phase-1 cells honoring per-tier trial counts, runs them with
config concurrency, resumable (skips cells whose meta.json shows success), `--dry-run` prints the
plan (must print `144 runs` for current config), `--limit N` for smoke tests. Progress to stdout
as one JSON line per completed run.

### 5. `tools/Report.ts`
Aggregates `grades.jsonl` → `results/phase1/REPORT.md`: per version×model table with routing-correct %,
task pass-rate (pass@k and pass^k where trials>1), mean tokens, mean wall-clock; per-tier breakdown;
and a "cells needing judge" list.

### 6. Fixtures (`fixtures/`)
Build every fixture named in the golden set, each a tiny self-contained bun project where relevant:
- `t1-edit`: notes/todo.md containing a 3-item list including "buy milk".
- `t2-bugfix`: src/paginate.ts with an off-by-one (last page dropped) + src/paginate.test.ts that
  fails against the bug and passes when fixed.
- `t2-script`: docs/ with 3 .md files totaling exactly 247 lines.
- `t2-csv`: data/sales.csv, 12 months, March highest with total 48720.
- `t3-build`: bare bun project (package.json, tsconfig) with empty src/ and a README naming the task.
- `t3-debug`: three modules (src/queue.ts, src/worker.ts, src/scheduler.ts) where worker consumes
  a queue the scheduler mutates during iteration — deterministic failing test included; smallest
  correct fix is one module.
- `t3-refactor`: src/report.ts (~80 lines, interleaved IO+logic), data input file, one green test,
  expected_output.txt with the exact current stdout.
- `t3-plan`: small JSON-file-storage app (2 modules + data/store.json).
- `t4-casual-complex`: data/metrics.json with a dozen plausible metrics.
- `t4-ambiguous`: bun project with one failing test (clear bug in src/, e.g. wrong comparator).
- `t4-multi`: bun project named "foldx" — name appears in package.json, README.md, 2 source files,
  and a string constant; includes a green test that doesn't depend on the name.
- `_synthetic-user/`: the fake "Alex Doe" user files described above.
Every fixture with tests must fail/pass exactly as the golden set expects — verify each one
yourself with `bun test` / the golden-set command before finishing.

## Acceptance (verify before you finish, report evidence)
1. `bun tools/Fleet.ts --dry-run` prints a 144-run plan.
2. `bun tools/StageVersion.ts RAW` produces a working sandbox.
3. Every fixture's baseline state matches its golden-set expectations (failing tests fail,
   line counts exact, csv totals exact). Show command output.
4. `bun test` in the repo root passes (write unit tests for Grade.ts graders at minimum).
5. Zero references to real personal data anywhere under fixtures/ or tools/.
