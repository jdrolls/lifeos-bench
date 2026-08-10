# lifeos-bench

Reproducible A/B benchmark for AI scaffolding frameworks — built in response to
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715):
*does the scaffolding actually improve outcomes, on which models, at what token cost?*

> **Phases 1–3 (432 runs) are retracted.** Three independent faults invalidated them: cells
> escaped their sandbox and read the operator's live install, the upstream lanes were staged
> without their constitutional system prompt, and the routing metric grepped for a feature v7
> had deliberately removed. The correction is documented in [`PHASE_PLAN.md`](PHASE_PLAN.md);
> the retracted headlines are preserved in git history, not here.

## What it measures

Golden set **2.0.0** (frozen 2026-08-09; deliberately breaks comparability with anything prior).

| Axis | Values |
|---|---|
| **Scaffolding** | `RAW` (bare Claude Code, control) · `L5` (PAI v5.0.0) · `L6` (LifeOS v6.0.5) · `L7` (LifeOS v7.28.3) |
| **Model** | Sonnet 5 · Fable 5 · Haiku 4.5 · Opus 5 · Opus 4.8 (native) · GPT-5.6 terra / luna / sol (same Claude Code harness via a local ChatGPT-auth proxy, so hooks behave identically) |
| **Prompts** | 21 frozen prompts across 5 tiers — simple assistant tasks, medium coding, complex algorithmic work, routing traps, and personalization (`goldenset/goldenset.json`) |

Per cell we grade, deterministically where possible:

1. **Routing** — `code:algorithm_read`: did the scaffold read its Algorithm before substantial
   work? Version-neutral by design: v7 retired modes, so banner-grepping cannot compare versions.
2. **Format compliance** — a separate column from routing. A version can honour its output
   contract and have no modes at all; conflating the two produced a retracted headline.
3. **Task pass-rate** — checkable expectations (tests pass, exact outputs, files changed or
   unchanged), pass@k / pass^k across trials.
4. **Overhead** — output tokens and wall-clock per cell.
5. **Quality floor** — LLM-judge rubrics for non-checkable outputs, judged **cross-vendor**:
   Claude-family cells judged by GPT, GPT-family cells by a blinded Claude. Nothing self-grades.

## Isolation

Three mechanisms, because they solve different problems:

| Concern | Mechanism |
|---|---|
| **Fidelity** | `$HOME` → a per-cell clone of `sandboxes/_home/<VERSION>`, with the staged install physically at `<HOME>/.claude` so upstream's cross-root relative imports (`../../../.claude/...`) resolve |
| **Independence** | the staged tree is a **template**: every cell clones it and the seatbelt grants the template no write access, so a scaffold's hooks cannot carry state into the next cell |
| **Safety** | `sandbox-exec` seatbelt denying the operator's home; the child environment is scrubbed of operator paths and ephemeral session shims |
| **Validity** | `LeakCheck` marks any escape `contaminated`; a dirty fleet does **not** get a report |

Cells run with their cwd and their `$HOME` outside the operator home — required, not tidy: a Bun
process whose cwd sits inside the seatbelt's denied subtree starts with an empty `process.env`, and
every scaffold hook is `#!/usr/bin/env bun`. Each cell records what its hooks wrote
(`home-writes.txt`, `home-state/`, `meta.hook_state`), so "did the enforcement layer actually run"
is answerable from the artifacts rather than by re-probing the machine.

Persona is Bruce Wayne / Alfred — disjoint from the operator by construction, which makes the
operator's own identifiers a continuous tripwire. Nothing credential-bearing is placed in a
sandbox; cells authenticate from an OAuth token held outside every sandbox.

## Layout

```
goldenset/        frozen prompts + expectations + judge rubrics
bench.config.json matrix, trials, per-version markers
fixtures/         per-prompt starting workspaces + the synthetic persona
tools/            StageVersion / RunCell / Grade / Judge / Fleet / LeakCheck / Report
results/          transcripts + grades + REPORT.md (gitignored pending publication review)
vendor/           upstream checkouts (gitignored)
sandboxes/        staged installs (gitignored)
_archive/         retired and pre-fix artifacts (gitignored)
```

## Running

```bash
bun test                                   # 57 tests, 0 failures
bun tools/StageVersion.ts L5 --force       # and L6, L7, RAW
bun tools/Fleet.ts --dry-run | wc -l       # 560 = the full matrix

# A wave is (versions x models); Waves B and C share versions and differ only by model, so
# --models is required to separate them. Re-running the same command is the resume sweep:
# Fleet skips cells whose meta.json says "success" and retries everything else.
FLEET_VERSIONS=L5,L6 FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &

# After a wave, judge cross-vendor (one pass per vendor — JUDGE_CMD is a single template):
JUDGE_CMD='bun <CodexExec> --model gpt-5.6-terra --prompt-file {promptfile}' \
  bun tools/Judge.ts --model sonnet-5,fable-5,haiku-4-5,opus-5,opus-4-8
JUDGE_CMD='bash tools/claude-judge.sh {promptfile}' \
  bun tools/Judge.ts --model gpt-5.6-terra,gpt-5.6-luna,gpt-5.6-sol
bun tools/Report.ts
```

Claudex lanes additionally need CLIProxyAPI up on `:8317` and signed in.

## Status

**Phase 4 ran to completion — 560/560 cells, 559 `success`, containment clean, zero pending
judges — but its scaffolded lanes must be re-run.** Full numbers:
[`results/phase1/REPORT.md`](results/phase1/REPORT.md). The one failure is
`RAW/opus-5/t4-casual-complex/trial-2`, a reproducible 1200s timeout recorded as such rather than
rescued by raising the ceiling.

> **Every scaffolded lane ran with its hook layer disabled** (found 2026-08-10). The seatbelt's
> home read-deny emptied `process.env` for any Bun process whose cwd sat inside the operator home,
> and every scaffold hook is `#!/usr/bin/env bun`. Cells recording hook failures: **L5 66/68,
> L6 67/68, L7 210/212 — RAW 0/212**, because RAW registers no hooks. So Phase 4 measured the
> *prompt-and-context* half of each scaffold (system prompt, `CLAUDE.md`, imports — all CLI flags
> and file reads, all working) with the *enforcement* half switched off. For a framework whose
> founding principles include "code before prompts", that understates it. L5/L6/L7 are being
> re-run; RAW-only figures are unaffected.

> **Turning the hooks on took three fixes, not one, and the first two each hid the next.**
> (1) the cwd/`process.env` fault above (`Sandbox.runWorkspace`); (2) no `node_modules` in any
> staged install, so hooks importing `yaml` died on `bun is unable to write files to tempdir`
> (`StageVersion.installDependencies`); (3) with hooks finally running, they wrote their state back
> into the **shared** staged install — L7 put 29 files there per cell, v5 rewrote the staged
> `settings.json` itself — making each cell depend on the one before it. Every cell now clones its
> own `$HOME` (`Sandbox.prepareCellHome`). Nothing before fix 3 is a valid scaffolded measurement.
>
> **RAW's Phase 4 figures survive fix 3**, on the argument that a version registering no hooks has
> nothing that writes to `$HOME` at runtime: what the shared home accumulated for RAW was Claude
> Code's own bookkeeping (`.claude.json`, per-cwd `projects/` session logs, telemetry caches), and
> each cell already had a unique cwd, so no session was ever resumed into another cell. The
> scaffolded lanes had no such argument — their hooks demonstrably wrote context-bearing state.

Findings — (1) and (3) span all eight models; (2) is the version bisect, which runs on the two
bisect models by design:

1. **The scaffolding helps or is neutral on seven of eight models.** RAW vs L7, pass@k:
   sonnet-5 **+19.0**, opus-4-8 **+9.5**, haiku-4-5 **+4.7**, and 0.0 on fable-5, opus-5, terra,
   luna and sol. On pass^k only fable-5 declines (−4.8, a single prompt).
2. **Version comparison (2 bisect models).** L5 leads on task pass@k (100%) but spends 7.7k–8.5k
   output tokens per cell; L6/L7 reach 95%/95% for 2.0k–3.8k. Format compliance improves
   monotonically: L5 80% → L6 100% → L7 100%.
3. **Both retracted Phase 1–3 headlines fail on corrected data.** No model passes 100% bare — RAW
   spans 66.7–85.7% — so the ceiling that made scaffolding look pointless was an artifact of the
   old prompt set. And "small models get worse under scaffolding" does not reproduce: Haiku 4.5
   *gains* (+4.7 pass@k, +9.6 pass^k), paying its cost in format compliance (66.7% vs 100%
   elsewhere) rather than in task success. The curve is diminishing returns toward current
   frontier, not an inverted U.

## Known limitations

Read these before quoting any number.

- **Routing was not measurable for L6 in the Phase 4 data**, and **L7 has no router to measure** —
  v7.28.3 retired modes and registers no classifier hook at all. For L6 the earlier explanation
  ("Claude Code spawns hooks with an empty environment") was **wrong**: a `/usr/bin/env` probe
  registered as a real hook inside a real cell prints 121 variables. The actual cause was the
  seatbelt — a Bun process whose cwd sat inside the denied operator home started with
  `process.env` completely empty, so the router's `spawn('claude')` could not resolve a binary
  that was on its PATH the whole time. Cells now run with a cwd outside that tree
  (`Sandbox.runWorkspace`) and the router reaches its classifier. It then fails one layer later:
  Claude Code passes no auth variable to hooks and the sandbox `HOME` holds no credentials by
  design, so the nested `claude` cannot authenticate. So `algorithm_read` for L6 still measures
  *unrouted* model behavior and must not be reported as a regression. L5 is unaffected: v5 routes
  via prose in `CLAUDE.md`, which spawns nothing. Read correctly, the L7 routing column
  (40% Claude / 100% GPT) is a finding about instruction-following without enforcement.
- **Hooks that call an LLM cannot work in-sandbox, by choice.** v6's router and v5/v6/v7's
  satisfaction-rating hooks spawn a nested `claude`. Claude Code passes no auth variable to hook
  subprocesses and the sandbox `HOME` holds no credentials by design, so those hooks reach their
  classifier and then fail authentication — visible verbatim in the captured state
  (`ratings.jsonl`: `Inference failed: api error: claude JSON envelope is_error=true`). Deterministic
  hooks are unaffected and do run; `format-gate.jsonl` records a real pass/fail per response.
- **A fresh install of v6/v7 reports its own memory hooks as missing.** `MemoryHealthCheck` treats
  `settings.system.json` as the source of truth, but upstream's `InstallHooks` merges
  `install/hooks/hooks.json` into `settings.json` only, and the shipped `install/settings.system.json`
  registers none of the memory hooks. So every scaffolded cell carries a
  `🩺 MEMORY HEALTH: CRITICAL … NOT registered` banner into its context and often into its answer.
  That is upstream behaviour faithfully reproduced, not a staging error — the hooks themselves are
  registered and do run — but it consumes context and shows up in graded output.
- **RAW is bare of LifeOS, not of all scaffolding.** The control still has Claude Code's bundled
  skills; one cell was observed invoking `dataviz` to build its page.
- **Single- and double-trial cells are noisy.** Format compliance has been observed varying run to
  run on an identical lane. Headline claims need the Phase 5 five-trial confirmation.
- **The judge bar is permissive.** `min_score` is 3 of 5 with ~68% of scores at 5, so task
  pass-rate has weak power to separate versions.
- **Wall-clock is not comparable across runs** at `concurrency > 1`; cells contend for CPU. Wave C
  timings recorded before the process reaper landed are additionally contended by leaked browser
  processes. Token counts, routing, format and pass-rates are unaffected.

## Grader integrity

Fifteen harness and grader defects were found and fixed while building this, each with a regression
test. They are listed because a benchmark's credibility rests on how its own errors were caught,
not on the absence of errors:

| Defect | Effect |
|---|---|
| L6/L7 staged with **zero hooks** | Their enforcement layer never ran; format scored 0% |
| Config root not nested under `$HOME` | Upstream relative imports crashed the format-enforcing hook |
| Inherited `PATH` carried operator paths | Clean cells marked `contaminated` on an env dump |
| Real OAuth credentials reachable in-sandbox | Credential exposure under `bypassPermissions` |
| `LeakCheck` patterns unanchored | Scaffold *documentation* scored as an escape |
| `workspace_diff_count` counted hook state | Penalised only versions **with** hooks — silently favoured the control |
| Claude-side judge not blinded | Graded synthetic-persona answers against the **operator's real profile** |
| Judge prompt omitted the persona | T5 grounding judged against materials the judge could not see |
| `Fleet`/`Judge` had no wave or vendor filter | Wave B would have run 424 cells; cross-vendor blinding was inexpressible |
| Cells leaked browser processes | Orphaned Chrome drove machine load to 13; inflated wall-clock and caused false "timeouts" |
| `LeakCheck` counted a kernel refusal as an escape | Invalidated a cell whose boundary *held*, when Chrome's crashpad probed the operator's profile and was denied |
| Cell cwd inside the seatbelt's denied home | Emptied `process.env` for **every** Bun hook, disabling v6's router and producing a routing result that was really a harness artifact |
| No `node_modules` in any staged install | Hooks import `yaml` from 13–14 of their own files; Bun's auto-install cannot write a tempdir inside the seatbelt, so the hook layer still could not start after the cwd fix |
| Staged install **shared** by every cell in a lane | Hooks wrote context-bearing state (`drift-reminder.json`, `work.json`, `session-names.json`, and v5's own `settings.json`) into the tree the next cell loads — cross-cell coupling, and a race under `concurrency > 1` |
| Hook-state capture copied vendored plugin docs | A bundled doc quoting `/Users/alice/.claude` landed in the graded artifact directory, where `LeakCheck` correctly read it as an escape and marked a clean cell `contaminated` |

Two are worth singling out. **`workspace_diff_count`** was one-directional — only versions *with*
hooks could be penalised — so it biased the benchmark toward its own null hypothesis. It was
caught by auditing a result that looked too clean: the bare control beating a scaffold 4/4 to 0/4.
And **the unblinded judge** failed correct answers for citing the synthetic persona instead of the
operator's real projects; the containment gate caught it, on the harness's own code.
