# lifeos-bench

A reproducible A/B benchmark for AI scaffolding frameworks, built to answer
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715): *does the
scaffolding actually improve outcomes, on which models, at what token cost?*

**It is two things.** A study — three released LifeOS versions against a bare control, across eight
models, on a frozen 21-prompt golden set. And a **harness you can point at your own framework**:
sandboxed, resumable, cross-vendor-judged, with a containment gate that invalidates a run rather
than quietly reporting it.

The written-up findings are in **[`docs/report.html`](docs/report.html)**, generated from
[`docs/report-data.json`](docs/report-data.json). The rest of this file is how to run it yourself.

---

## Findings in four lines

- **On general work (T1–T4), LifeOS is roughly neutral.** Bare control 96.9% pass@k; L5 96.9%,
  L6 93.8%, L7 90.6%. Each step is one or two prompts — inside the noise a two-trial design can
  resolve, but consistent in direction.
- **On personalization (T5) it is decisive.** Control 40.0%; every LifeOS version 90–100%. The
  control structurally cannot know the user.
- **The Algorithm has stopped firing on Claude models.** On heavy work: L5 enters it 5–6 of 6;
  L6 0 of 6 (confounded — see below); L7 **0 of 6 on every Claude model and 6 of 6 on every GPT-5.6
  model**, from the same prose instruction. That is instruction compliance, not capability — and
  the difference from L5 is *register*, not presence: L5 says "MANDATORY FIRST ACTION", L7 says
  "First action for such work".
- **Cost is where versions separate.** L5 spends 10.9k output tokens per cell against L6's 2.0k and
  L7's 2.9k, for no measurable general-task gain.

Full tables, charts and caveats: [`docs/report.html`](docs/report.html).

---

## Reproduce it

### Prerequisites

- macOS (the isolation layer uses `sandbox-exec`), Bun, and the Claude Code CLI on `PATH`.
- **bun/bunx only — never npm/npx.**
- An OAuth token for the CLI at `sandboxes/_auth/oauth-token`, held *outside* every sandbox.
- For GPT lanes: CLIProxyAPI signed in and listening on `:8317`.
- ~20GB free disk and several hours. The published run was 560 cells, 17.1 h of cell wall-clock and
  **$359.37**.

### Vendor the frameworks under test

`StageVersion.ts` copies from checkouts you provide — it never fetches:

```
vendor/LifeOS-v5/Releases/v5.0.0/.claude   → staged as L5
vendor/LifeOS-v6/LifeOS/install            → staged as L6
vendor/LifeOS/LifeOS/install               → staged as L7
```

Clone each upstream repo at the tag you want into those paths.

### Run

```bash
bun test                                   # 105 tests, 0 failures
bun tools/StageVersion.ts RAW --force      # and L5, L6, L7
bun tools/Fleet.ts --dry-run | wc -l       # 560 = the full matrix

# A wave is (versions × models). Waves that share versions must be separated by --models,
# or you run the whole matrix instead of the slice you wanted.
FLEET_VERSIONS=L5,L6 FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &

# Re-running the same command IS the resume sweep: Fleet skips cells whose meta.json says
# "success" and retries everything else, including anything marked contaminated.
```

### Judge, report, verify

Judging is **cross-vendor by construction** — one pass per vendor, because `JUDGE_CMD` is a single
template and `--model` selects which cells each judge sees. Do not collapse these into one pass;
that lets a vendor grade its own output.

```bash
# Claude-family cells → a GPT judge
JUDGE_CMD='bun <path-to-CodexExec> --model gpt-5.6-terra --prompt-file {promptfile}' \
  bun tools/Judge.ts --model sonnet-5,fable-5,haiku-4-5,opus-5,opus-4-8

# GPT cells → a Claude judge, run with an empty config AND a neutral cwd
JUDGE_CMD='bash tools/claude-judge.sh {promptfile}' \
  bun tools/Judge.ts --model gpt-5.6-terra,gpt-5.6-luna,gpt-5.6-sol

bun tools/Report.ts                     # results/phase1/REPORT.md
bun tools/BuildReportPage.ts            # docs/report-data.json + docs/report.html
bun tools/LeakCheck.ts --root results   # MUST exit 0 — a dirty run does not get a report
```

Judging is resumable: re-running a pass judges only rows that still have no verdict.

Both isolations in `tools/claude-judge.sh` are load-bearing. Claude Code derives context from
`HOME` **and** from the working directory, so a judge started inside your own tree grades
synthetic-persona answers against *your* real profile and fails correct answers as ungrounded. That
was a real defect here, caught by the containment gate running on the harness's own code.

---

## Point it at your own framework

Add a version to `bench.config.json` and teach `StageVersion.ts` where its payload lives:

```jsonc
{
  "id": "MYFRAMEWORK",
  "kind": "upstream",
  "source": "vendor/my-framework@v1.2.3",
  "system_prompt": "path/inside/config-root/SYSTEM_PROMPT.md",  // passed via --append-system-prompt-file; a missing file is a hard error, never a silent skip
  "algorithm_path": "path/to/ALGORITHM",                        // what code:algorithm_read looks for
  "routing_markers": { "heavy": "regex", "light": "regex" },    // null if your framework has no modes — null by fact, not by omission
  "format_marker": "regex for your first-line output contract",
  "models_allowlist": ["sonnet-5", "gpt-5.6-terra"]
}
```

Four things are worth knowing before you do:

1. **Stage with the framework's own installer**, not a reimplementation. Half this project's
   retracted results came from staging that looked right and wasn't.
2. **Install its dependencies at staging time.** Hooks that `import` anything die inside the
   seatbelt, because Bun's auto-install cannot write a tempdir there.
3. **Overlay a synthetic user profile** disjoint from your own (`fixtures/_persona/blocks/`). That
   turns your real identifiers into a continuous tripwire: if one appears in a transcript, a cell
   escaped and `LeakCheck` invalidates it.
4. **Declare `routing_markers: null` if your framework has no modes.** Grepping for a banner a
   framework deliberately removed scores it 0% for a feature it deleted on purpose — that produced
   a headline here that had to be retracted.

---

## The isolation model

Four mechanisms, because they solve four different problems. All of it is in `tools/Sandbox.ts`.

| Concern | Mechanism |
|---|---|
| **Fidelity** | `$HOME` → a per-cell clone of `sandboxes/_home/<VERSION>`, with the config root physically at `<HOME>/.claude` — frameworks import across it with `../../../.claude/...`, which bypasses `HOME` resolution, so a symlink or sibling directory is not equivalent |
| **Independence** | the staged tree is a **template**: every cell clones it (`cp -Rc`, an APFS clone) and the seatbelt grants the template no write access, so one cell's hooks cannot carry state into the next |
| **Safety** | a `sandbox-exec` profile denying your real home outright; the child environment is scrubbed of your paths and of ephemeral shell shims |
| **Validity** | `LeakCheck` marks any escape `contaminated`, and a dirty fleet does **not** get a report |

Two placement rules are load-bearing, and both were learned expensively:

- **The cell's working directory must sit outside your home.** Under the seatbelt, a Bun process
  whose cwd is inside the denied subtree starts with a **completely empty `process.env`** — and
  every framework hook is a Bun script, so the entire enforcement layer runs dead while looking
  fine. The workspace is copied back beside its artifacts afterwards.
- **Every cell needs its own `$HOME`.** Framework hooks write runtime state into `$HOME/.claude`.
  Sharing one staged tree makes cell N's context depend on what cell N−1 left behind, and races it
  under concurrency.

Because that first failure was invisible in the artifacts, **every cell now records what its hooks
wrote** — `home-writes.txt`, `home-state/`, and a count in `meta.json`. "Did the enforcement layer
actually run" is a number in your dataset, not a hope. In the published run: L5 24.0, L6 21.8,
L7 25.4 files per cell; the control, which registers no hooks, zero.

**Nothing credential-bearing goes in a sandbox.** The direct consequence is that a hook which
spawns a nested model call cannot authenticate, so hook-driven routing is unmeasurable by this
method. That is a stated limit of the design, not a bug queued for repair — decide for yourself
before copying it.

---

## The golden set

21 prompts, five tiers, frozen as **2.0.0** in `goldenset/goldenset.json`. Freezing is the point:
change a prompt and you have a new golden set, so the version string is part of every result.

| Tier | Probes | Trials |
|---|---|---:|
| T1 | trivial requests — does the framework get out of the way | 1 |
| T2 | ordinary coding and analysis | 1 |
| T3 | heavy engineering — where an Algorithm should fire | 2 |
| T4 | traps where phrasing and scope disagree | 2 |
| T5 | personalization against the synthetic profile | 2 |

`tier_models` restricts T5 to two models, so **six of the eight lanes were scheduled for 16 prompts
and two for 21**. Pass-rates divide by what a lane actually ran — comparing a 16-prompt lane against
a 21-prompt one is how this project published a wrong headline for a whole phase.

Grading keeps four things in separate columns and never averages them:

- **Algorithm entered** — did it read the Algorithm before *heavy* work (3 prompts × 2 trials)?
- **Algorithm skipped** — did it correctly *not* read it for trivial work? Every version passes
  these, which is exactly why they cannot share a column with the first.
- **Mode markers** — the framework's own banner, where it has one.
- **Task pass-rate** — everything checkable, as pass@k and pass^k.

A `skipped` grader means *this check cannot apply to this version*, and is excluded from both
numerator and denominator. It is never a failure.

---

## Layout

```
goldenset/        frozen prompts + expectations + judge rubrics
bench.config.json matrix, trials, per-version markers
fixtures/         per-prompt starting workspaces + the synthetic persona
tools/            StageVersion · RunCell · Grade · Judge · Fleet · LeakCheck · Aggregate · Report · BuildReportPage
docs/             the report page, its aggregate dataset, authored narrative, defect list (tracked)
results/          transcripts + grades + REPORT.md (gitignored pending publication review)
vendor/           upstream checkouts you provide (gitignored)
sandboxes/        staged installs (gitignored)
_archive/         retired and pre-fix artifacts, quarantined out of the containment scan (gitignored)
```

---

## Run status

560 cells, 559 `success`, containment clean (18827 files scanned, 0 violations — and 0 for each
live lane alone: RAW 5051, L5 3338, L6 2137, L7 8293), 220 rubric verdicts with zero judge errors
and zero rows unjudged. Recorded cost **$359.37** across 17.1 hours of cell wall-clock.

The single failure is `RAW/opus-5/t4-casual-complex/trial-2`, a reproducible 1200s timeout — it
failed twice, the second time on an idle machine — recorded as a timeout rather than rescued by
raising the ceiling mid-analysis.

---

## Known limitations

Read these before quoting any number.

- **Hook-driven routing is unmeasurable by this method, and L7 has no classifier to measure.** Only
  v6 registers a mode/Algorithm classifier (`TheRouter.hook.ts`); v7.28.3 retired modes and ships
  none. v6's router spawns a nested `claude`, Claude Code passes no auth variable to hook
  subprocesses, and the sandbox `HOME` holds no credentials by design — so it reaches its classifier
  and fails authentication. L6's Algorithm-entry figure therefore measures *unrouted* model
  behaviour and must not be reported as a regression. **L5 and L7 are unaffected**: both carry the
  instruction as prose, which spawns nothing. v7 does still register six `UserPromptSubmit` hooks,
  but they are deterministic and make no model call, so the credential boundary never touches them —
  and none of them decides whether to enter the Algorithm.
- **A fresh v6/v7 install reports its own memory hooks as missing.** `MemoryHealthCheck` reads
  `settings.system.json` while `InstallHooks` merges into `settings.json` only, and the shipped
  `install/settings.system.json` registers none of the memory hooks. Every scaffolded cell carries
  a `🩺 MEMORY HEALTH: CRITICAL` banner into its context and often into its answer. Upstream
  behaviour faithfully reproduced — but it consumes context and shows up in graded output.
- **Trial counts are low.** One prompt is worth 4.8 points on a 21-prompt lane, 6.3 on a 16-prompt
  one. Format compliance has been observed varying run to run on an identical lane.
- **The judge bar is permissive.** `min_score` is 3 of 5; scores are bimodal (120 fives, 34 ones of
  220) and all 35 threes pass — including one whose own reasoning says the answer failed the thing
  the rubric asked about. Raising the bar to 4 reclassifies 16% of verdicts.
- **Wall-clock is not comparable** at `concurrency > 1`; cells contend for CPU. Tokens, cost,
  Algorithm entry, format and pass-rates are unaffected.
- **The control is bare of LifeOS, not of all scaffolding** — it still has Claude Code's bundled
  skills.
- **The control's cells were retained, not re-run** after the last harness fix, on the argument
  that a version registering no hooks has nothing writing to `$HOME` and every cell already had a
  unique cwd. If you doubt that, re-run the control's 212 cells rather than hedging the number.
- **Cells can act on the host outside the seatbelt.** A cell that renders a page launches a browser
  through the OS; leftover tabs pointing at cell workspaces were found afterwards. Nothing flows
  back into the cell and containment scans clean, but "the cell cannot affect the host" is not a
  claim this harness can make.
- **Everything thicker than one turn is unmeasured** — memory across sessions, multi-turn work,
  delegation, skills at scale. See *What this benchmark cannot see* in the report.

---

## Grader integrity

Nineteen harness, grader and artifact-hygiene defects were found and fixed while building this,
each with a regression test. The machine-readable list is [`docs/defects.json`](docs/defects.json),
which is also what the report page renders.

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
| `Fleet`/`Judge` had no wave or vendor filter | A wave would have run 424 cells instead of 136; cross-vendor blinding was inexpressible |
| Cells leaked browser processes | Orphaned Chrome drove machine load to 13; inflated wall-clock and caused false "timeouts" |
| `LeakCheck` counted a kernel refusal as an escape | Invalidated a cell whose boundary *held* |
| Cell cwd inside the seatbelt's denied home | Emptied `process.env` for **every** Bun hook, disabling the enforcement layer while it looked healthy |
| No `node_modules` in any staged install | Hooks import `yaml` from 13–14 of their own files; Bun's auto-install cannot write a tempdir inside the seatbelt |
| Staged install **shared** by every cell in a lane | Hooks wrote context-bearing state into the tree the next cell loads — cross-cell coupling, and a race at `concurrency > 1` |
| Hook-state capture copied vendored plugin docs | A bundled doc quoting an example home path landed in the graded artifact directory, where `LeakCheck` correctly read it as an escape |
| A **`skipped` grader counted as a task failure** | Turned a documented exemption into a penalty — and only the control was ever exempt |
| **Prompts a lane never ran counted against it** | Six of eight lanes graded on five prompts never sent to them. Up to 23.8 points per lane, and the sole source of the retracted "no model passes 100% bare" |
| **Algorithm entry averaged with Algorithm skip** | Every version passes the skip checks, so a combined column dragged a 0-of-6 up to a passing-looking 40% and hid the largest effect in the dataset |

Four share a shape worth naming. `workspace_diff_count`, the skipped grader, the unrun prompts, and
the averaged Algorithm columns were all **one-directional** — each could only ever move the numbers
one way, and three of the four moved them toward the benchmark's own null hypothesis. None was
caught by a test. Each was caught by asking why a figure looked wrong.
