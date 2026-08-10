# lifeos-bench

Reproducible A/B benchmark for AI scaffolding frameworks — built in response to
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715):
*does the scaffolding actually improve outcomes, on which models, at what token cost?*

A rendered walkthrough of the whole study — method, charts, corrections, limitations — is at
[`docs/report.html`](docs/report.html), generated from [`docs/report-data.json`](docs/report-data.json)
by `bun tools/BuildReportPage.ts`.

> **Phases 1–3 (432 runs) are retracted.** Three independent faults invalidated them: cells
> escaped their sandbox and read the operator's live install, the upstream lanes were staged
> without their constitutional system prompt, and the routing metric grepped for a feature v7
> had deliberately removed.
>
> **Phase 4's scaffolded numbers are superseded too** — every L5/L6/L7 cell in that run had its
> hook layer silently disabled. Both corrections are documented in [`PHASE_PLAN.md`](PHASE_PLAN.md);
> the retracted headlines live in git history, not here.

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
4. **Overhead** — output tokens, wall-clock and cost per cell.
5. **Quality floor** — LLM-judge rubrics for non-checkable outputs, judged **cross-vendor**:
   Claude-family cells judged by GPT, GPT-family cells by a blinded Claude. Nothing self-grades.

`tier_models` restricts the personalization tier to the two bisect models, so **six of the eight
model lanes were scheduled for 16 prompts and two for 21.** Pass-rates are computed against the
prompts a lane actually ran; compare a lane only against the same model's other lane.

## Isolation

Four mechanisms, because they solve different problems:

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
tools/            StageVersion / RunCell / Grade / Judge / Fleet / LeakCheck / Aggregate / Report / BuildReportPage
docs/             report page, its aggregate dataset, authored narrative, defect list (tracked)
results/          transcripts + grades + REPORT.md (gitignored pending publication review)
vendor/           upstream checkouts (gitignored)
sandboxes/        staged installs (gitignored)
_archive/         retired and pre-fix artifacts (gitignored)
```

## Running

```bash
bun test                                   # 103 tests, 0 failures
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

bun tools/Report.ts            # results/phase1/REPORT.md
bun tools/BuildReportPage.ts   # docs/report-data.json + docs/report.html
bun tools/LeakCheck.ts --root results   # must exit 0
```

Claudex lanes additionally need CLIProxyAPI up on `:8317` and signed in. Judging is resumable —
re-running the same command judges only rows that still have no verdict.

## Status

**Complete and judged.** 560 cells, 559 `success`, containment clean (`18827` files scanned, 0
violations; and 0 for each live lane scanned on its own: RAW 5051, L5 3338, L6 2137, L7 8293
files), 220 rubric verdicts with zero judge errors and zero rows left unjudged. Every
scaffolded cell ran with a working hook layer, evidenced per cell: L5 24.0, L6 21.8 and L7 25.4
hook-state files written per cell on average, against RAW's zero. Total recorded cost $359.37
across 17.1 hours of cell wall-clock.

The single failure is `RAW/opus-5/t4-casual-complex/trial-2`, a reproducible 1200s timeout (it
failed twice, the second time on an idle machine) recorded as such rather than rescued by raising
the ceiling. Full tables: [`results/phase1/REPORT.md`](results/phase1/REPORT.md) and
[`docs/report.html`](docs/report.html).

### Findings

**1. On general tasks the scaffolding does not help.** Across T1–T4, on the two models every
version ran:

| Version | T1–T4 pass@k | T1–T4 pass^k | Mean output tokens/cell |
|---|---:|---:|---:|
| RAW | **96.9%** | 93.8% | 2.8k |
| L5 | 96.9% | 90.6% | 10.9k |
| L6 | 93.8% | 93.8% | 2.0k |
| L7 | 90.6% | 87.5% | 2.9k |

The six-model sweep agrees with more samples: RAW 95.8% vs L7 93.8% pass@k on T1–T4. The spread
is inside what one or two trials can resolve — but it is not a gain, and the direction is
consistent.

**2. On personalization it is decisive.** T5, same two models:

| Version | T5 pass@k | T5 pass^k |
|---|---:|---:|
| RAW | **40.0%** | 10.0% |
| L5 | 100.0% | 60.0% |
| L6 | 90.0% | 70.0% |
| L7 | 90.0% | 60.0% |

Large, consistent across all three versions and both models, and close to tautological — the
control structurally cannot know the persona. What it establishes is that the delivery mechanism
works: the profile reaches the model and changes the answer.

**3. The bare control is stronger than previously published.** Four of eight models reach **100%
pass@k with no scaffolding at all** (fable-5, opus-5, gpt-5.6-luna, gpt-5.6-sol, on the 16
prompts those lanes ran). The earlier "no model passes 100% bare" was an artifact of grading six
lanes on five prompts they were never scheduled to run — defect 17 below.

**4. Newest version minus control, per model (pass@k):** sonnet-5 **+14.3**, opus-4-8 **+6.3**,
fable-5 / haiku-4-5 / terra / luna 0.0, opus-5 **−6.2**, sol **−12.5**. It does not sort by model
tier. One prompt is worth 4.8–6.3 points at these trial counts, so only the outer two are outside
the noise band.

**5. Cost is where the versions separate cleanly.** L5 spends ~10.9k output tokens per cell against
L6's 2.0k and L7's 2.9k, for a task pass-rate inside the noise band — a 4–5× premium. Format
compliance moves the other way and is where the newer versions genuinely improve: L5 70% → L6 100%
→ L7 96.4%, the last dragged down entirely by Haiku 4.5 at 66.7%.

**6. Routing measures instruction-following, not enforcement** — see limitations. Under L7 all
three GPT lanes read the Algorithm 100% of the time and the Claude lanes 40–50%. The split is by
vendor, not by version.

## Known limitations

Read these before quoting any number.

- **Hook-based routing is structurally unmeasurable by this method, and L7 has no router to
  measure.** Only v6 registers a classifier hook; v7.28.3 retired modes and ships none. v6's
  router spawns a nested `claude`, Claude Code passes no auth variable to hook subprocesses, and
  the sandbox `HOME` holds no credentials by design — so it reaches its classifier and fails
  authentication. That is a deliberate isolation invariant, not a defect awaiting repair. L6's
  `algorithm_read` therefore measures *unrouted* model behaviour and must not be reported as a
  scaffold regression. L5 is unaffected: v5 routes via prose in `CLAUDE.md`, which spawns nothing.
  That asymmetry is itself a result — prose routing survives an environment where hook-based
  routing cannot run.
- **Hooks that call an LLM cannot work in-sandbox, by choice.** v6's router and v5/v6/v7's
  satisfaction-rating hooks spawn a nested `claude`; the failure is visible verbatim in the
  captured state (`ratings.jsonl`: `Inference failed: api error: claude JSON envelope is_error=true`).
  Deterministic hooks are unaffected and do run; `format-gate.jsonl` records a real pass/fail per
  response.
- **A fresh install of v6/v7 reports its own memory hooks as missing.** `MemoryHealthCheck` treats
  `settings.system.json` as the source of truth, but upstream's `InstallHooks` merges
  `install/hooks/hooks.json` into `settings.json` only, and the shipped `install/settings.system.json`
  registers none of the memory hooks. Every scaffolded cell therefore carries a
  `🩺 MEMORY HEALTH: CRITICAL … NOT registered` banner into its context and often into its answer.
  Upstream behaviour faithfully reproduced, not a staging error — but it consumes context and
  shows up in graded output.
- **Single- and double-trial cells are noisy.** One prompt is worth 4.8 points on a 21-prompt lane
  and 6.3 on a 16-prompt lane. Format compliance has been observed varying run to run on an
  identical lane.
- **The judge bar is permissive, and demonstrably so.** `min_score` is 3 of 5. Scores are bimodal
  (120 fives and 34 ones of 220), but all 35 threes are admitted — including at least one whose
  own reasoning says the response "does not acknowledge the standing preference" the rubric asked
  about. Raising the threshold to 4 would reclassify 16% of verdicts, larger than most version
  differences here.
- **Wall-clock is not comparable across runs** at `concurrency > 1`; cells contend for CPU. Token
  counts, cost, routing, format and pass-rates are unaffected.
- **RAW is bare of LifeOS, not of all scaffolding.** The control still has Claude Code's bundled
  skills; one cell was observed invoking `dataviz` to build its page.
- **RAW's cells were retained, not re-run**, on the argument that a version registering no hooks
  has nothing writing to `$HOME` at runtime, and every cell already had a unique cwd. If that
  argument is ever doubted, the remedy is to re-run RAW's 212 cells, not to hedge the numbers.
- **Cells can act on the host outside the seatbelt.** A cell that renders a page launches a browser
  through the OS; leftover tabs pointing at cell workspaces were found in the operator's browser
  session. Nothing flows back into the cell and containment scans clean, but "the cell cannot
  affect the host" is not a claim this harness can make.

## Grader integrity

Eighteen harness, grader and artifact-hygiene defects were found and fixed while building this, each with a
regression test. The machine-readable list is [`docs/defects.json`](docs/defects.json), which is
also what the report page renders.

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
| A **`skipped` grader counted as a task failure** | The golden set skips checks that cannot apply to a version — the control cannot know the persona — so a documented exemption became a penalty. Penalised only the control |
| **Prompts a lane never ran counted against it** | `tier_models` restricts T5 to two models, but pass@k divided by all 21 prompts regardless, so six of eight lanes were graded on five prompts never sent to them. Understated every restricted lane by up to 23.8 points and produced the retracted "no model passes 100% bare" |
| Retired-lane artifacts left inside the scanned tree | The retired private-fork lane's cells still sat in `results/` and legitimately contain real identity, so a full scan reported 101 violating files with **zero in any live cell** — a gate whose exit code no longer separated a sandbox escape from a retired lane's own content. Fixed by quarantining those trees under `_archive/`, **not** by exempting them from the scanner |

Four are worth singling out, because they share a shape. **`workspace_diff_count`**, **the skipped
grader**, and **the unrun prompts** were all one-directional — each could only ever move the
numbers one way, and two of the three moved them toward the benchmark's own null hypothesis. None
was caught by a test; each was caught by asking why a figure looked wrong. And **the unblinded
judge** failed correct answers for citing the synthetic persona instead of the operator's real
projects — caught by the containment gate, running on the harness's own code.
