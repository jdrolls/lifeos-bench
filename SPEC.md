# lifeos-bench — Harness Spec

What the harness does **now**. This file began as the Phase 0 build spec ("write these six
tools"); it is kept as the description of the built system, because a build spec that still
describes an intended harness after the harness exists is a trap for the next reader. The
Phase 0 deliverable list is in git history.

All code is TypeScript on Bun. **bun/bunx only — never npm/npx.**

`goldenset/goldenset.json` and `bench.config.json` are **frozen inputs**. Read them; changing
either breaks comparability with every recorded run, which is a golden-set version bump, not
an edit.

---

## 1. What a run is

One **cell** is one `(version, model, prompt, trial)`. The matrix is:

| Axis | Values |
|---|---|
| Version | `RAW` (bare control) · `L5` (PAI v5.0.0) · `L6` (LifeOS v6.0.5) · `L7` (LifeOS v7.28.3) |
| Model | sonnet-5 · fable-5 · haiku-4-5 · opus-5 · opus-4-8 · gpt-5.6 terra / luna / sol |
| Prompt | 21 frozen prompts, tiers T1–T5 (golden set 2.0.0) |
| Trials | T1 1 · T2 1 · T3 2 · T4 2 · T5 2 |

`models_allowlist` (per version) and `tier_models` (per tier) restrict lanes so the version
bisect does not pay for the full model sweep. `expected_runs` is 560.

GPT models run through the **same** Claude Code harness via a local ChatGPT-auth proxy, so
hooks fire identically. That is what isolates *prompts* from *plumbing*: a GPT lane and a
Claude lane differ in the model, not in the harness around it.

---

## 2. Isolation model

Four mechanisms, solving four different problems. All of them are in `tools/Sandbox.ts`.

| Concern | Mechanism |
|---|---|
| **Fidelity** | `$HOME` is redirected, and the staged config root sits *physically* at `<HOME>/.claude` — upstream imports traverse `../../../.claude/...`, which bypasses `HOME` resolution, so a sibling directory or a symlink is not equivalent |
| **Independence** | `sandboxes/_home/<VERSION>` is a **template**. Every cell clones it (`prepareCellHome`, `cp -Rc`, an APFS clone: ~0.5s for 26MB, no extra disk) into its own `$HOME` |
| **Safety** | a `sandbox-exec` seatbelt denies the operator's home outright, re-allowing only the read-only toolchain and the cell's own directories; the child environment is scrubbed of operator paths and ephemeral session shims |
| **Validity** | `tools/LeakCheck.ts` marks any escape `contaminated`; a dirty fleet does **not** get a report |

Two placement rules are load-bearing rather than tidy, and both were learned the hard way:

- **The cell's cwd lives outside the operator home** (`runWorkspace`, under `$TMPDIR`). Under
  the seatbelt, a Bun process whose cwd sits inside the denied subtree starts with a
  *completely empty* `process.env` — Bun reads something under the home at startup, the read
  is refused, and it yields an empty environment instead of failing. Every scaffold hook is
  `#!/usr/bin/env bun`, so with no `PATH` the entire hook layer was dead. The workspace is
  copied back beside its artifacts after the run.
- **The staged template is never re-allowed by the seatbelt.** Because each cell clones it,
  nothing inside a cell has any reason to write there, so leaving it under the blanket home
  deny makes "cells must not mutate the staged install" kernel-enforced rather than assumed.

**Nothing credential-bearing is placed in a sandbox.** Cells authenticate from an OAuth token
held outside every sandbox. The direct consequence is that a scaffold hook which spawns a
nested `claude` cannot authenticate — Claude Code passes no auth variable to hook subprocesses
— so hook-based LLM routing is **structurally unmeasurable by this method**. That is a stated
limitation of the benchmark, not a defect queued for repair.

**Persona.** `fixtures/_persona/blocks/` is the single source; `StagePersona.ts` renders it
byte-identically into all three install layouts. The persona is disjoint from the operator by
construction, which makes the operator's own identifiers a continuous tripwire.

---

## 3. Tools

| Tool | Contract |
|---|---|
| `StageVersion.ts` | Stages a version into `sandboxes/_home/<ID>/.claude`. `RAW` gets an empty config (no `CLAUDE.md`, no hooks). Upstream versions are copied from their `vendor/` checkout, have the persona overlaid, run their **own** `ActivateImports.ts`, and get `node_modules` installed (`installDependencies`) — hooks import `yaml` from a dozen of their own files, and Bun's auto-install cannot write a tempdir inside the seatbelt. Refuses to stage if the result contains an operator-identity token. Idempotent; `--force` re-stages. |
| `RunCell.ts` | Runs one cell headless: `claude -p <prompt> --model <cli_arg> --output-format stream-json`, `--append-system-prompt-file` from the version's `system_prompt` (a missing file is a hard error), `CLAUDE_CONFIG_DIR` at the cell's cloned config root, cwd the cell workspace, given its own process group (`detached: true` — macOS ships no `setsid`) so a timeout kills the whole tree, `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDECODE` scrubbed, never `--bare`. Timeout from config; a timeout is recorded as `status: "timeout"` and never silently retried. |
| `Grade.ts` | The code graders (see §4). Judge expectations emit `{status:"pending_judge"}` rows for the separate judging pass. |
| `Judge.ts` | Renders each pending rubric into a blinded prompt and runs it through `JUDGE_CMD`. `scrubResponse` strips framework banner lines before the judge sees anything. T5 judgments are supplied the persona as ground truth. Resumable: a re-run judges only rows with no verdict. |
| `Fleet.ts` | Enumerates the matrix, runs cells at `runner.concurrency`, resumable (skips cells whose `meta.json` says `success`, retries anything else), `--dry-run` prints the plan, `--versions` / `--models` / `--limit` select a wave. |
| `LeakCheck.ts` | Containment gate. Escape patterns and operator-identity tokens, assembled at runtime from fragments so the tool is not itself the leak. |
| `Aggregate.ts` | The single metric implementation. Every reporting surface reads it. |
| `Report.ts` | `results/phase1/REPORT.md` — version × model, per-tier breakdown, standing limitations, cells still needing a judge. |
| `BuildReportPage.ts` | `docs/report-data.json` (aggregate dataset) and `docs/report.html` (self-contained page). |

---

## 4. Grading

Three columns, deliberately separate:

1. **Routing** — `code:algorithm_read`: did the scaffold read its Algorithm before substantial
   work? Version-neutral, because v7.28.3 retired modes and banner-grepping cannot compare
   versions that disagree about whether modes exist.
2. **Format compliance** — `code:format_compliance`, its own column. A version can honour its
   output contract and have no modes at all; averaging the two together is exactly what
   produced a retracted headline.
3. **Task pass-rate** — everything else, as pass@k and pass^k across trials.

Code graders: `regex`, `file_contains`, `file_not_contains`, `file_exists`, `file_exists_any`,
`file_unchanged`, `workspace_diff_count`, `max_tool_calls`, `token_budget`, `command_exit`,
`command_output`, `command_output_matches_fixture`, `transcript_contains_command` (with
`before_first_edit`), `routing`, `algorithm_read`, `format_compliance`.

**Status semantics.** `pass` / `fail` / `skipped` / `pending_judge`. `skipped` means *this
check does not apply to this version* — the control structurally cannot know the persona, so
its T5 grounding checks skip. A skipped row is excluded from every numerator and denominator;
it is never counted as a failure. `workspace_diff_count` excludes scaffold hook state for the
same reason: counting it could penalise only versions that *have* hooks.

**Judges are blinded and cross-vendor.** Claude-family cells are judged by GPT, GPT cells by a
Claude judge run with an empty config and a neutral cwd — both load-bearing, because Claude
Code derives context from `HOME` *and* from the working directory, and an unisolated judge
grades synthetic-persona answers against the operator's real profile. Nothing self-grades.

---

## 5. Per-cell artifacts

`results/phase1/<VERSION>/<model>/<prompt-id>/trial-<n>/`:

| File | Contents |
|---|---|
| `transcript.jsonl` | the full stream-json transcript |
| `meta.json` | status, exit code, wall-clock, token usage, cost, final message, the exact argv, the resolved isolation paths, and `hook_state` |
| `workspace/`, `baseline/`, `workspace-diff.txt` | the post-run workspace, its starting state, and the diff |
| `sandbox.sb` | the seatbelt profile this cell actually ran under |
| `home-writes.txt` | every scaffold path the run wrote into its `$HOME` — the cheap answer to "did the enforcement layer run at all" |
| `home-state/` | those files copied back, because that is where a hook records its decision (`format-gate.jsonl` carries a literal pass/fail; `ratings.jsonl` carries a nested-inference failure verbatim) |

Claude Code's own housekeeping is **excluded** from the hook-state capture, not merely
uncopied: it is not scaffold behaviour, it is ~445 plugin files refreshed per cell, and one
of those vendored docs quotes an example home path that `LeakCheck` correctly reads as an
escape. v6 and v5 resolve `LIFEOS_DIR="$HOME/…"` literally and land a `$HOME/` directory in
the cwd; v7 patched that expansion and writes to the real home. Both are the same behaviour
and are counted as one.

---

## 6. Acceptance

Run these; report the evidence, not the intention.

1. `bun test` — all pass.
2. `bun tools/Fleet.ts --dry-run | wc -l` — prints `560`.
3. `bun tools/StageVersion.ts <ID> --force` — produces a sandbox whose `~/.claude/CLAUDE.md`
   probe returns that version's own banner.
4. Every fixture's baseline matches its golden-set expectations (failing tests fail, line
   counts exact, CSV totals exact).
5. `bun tools/LeakCheck.ts --root results` — exits 0.
6. Zero references to real personal data anywhere under `fixtures/`, `tools/`, or `docs/`.
