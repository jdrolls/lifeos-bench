# Benchmark Plan — Phases 4 through 6

Supersedes `PHASE4_PLAN.md`. Self-contained: a fresh session should be able to run this with
no prior conversation context.

---

## Why everything before this is discarded

432 runs completed across Phases 1–3. **All are invalid.** Three independent faults, each
sufficient on its own:

1. **Sandbox escape.** Cells set `CLAUDE_CONFIG_DIR` but not `$HOME`, and ran under
   `--permission-mode bypassPermissions` with no deny rules. Every scaffold references
   `~/.claude/...` thousands of times, so `~` resolved to the operator's live install. 127 of
   288 published transcripts contained operator-tree content; the RAW *control* read the
   operator's Algorithm doctrine as its first action in 68 of 144 cells. A control that reads
   a scaffold is not a control.
2. **Upstream lanes were under-installed.** `LIFEOS_SYSTEM_PROMPT.md` — the file carrying the
   response format, verification doctrine, and Algorithm instruction — was never loaded. The
   harness passed no `--append-system-prompt-file`, and its one attempt to activate the
   Algorithm (`@LIFEOS/ALGORITHM/8.17.3`) never resolved, because the file is `v8.17.3.md`
   and Claude Code does not extension-guess.
3. **The routing metric measured a retired feature.** Markers were `ALGORITHM|♻` and
   `MINIMAL|NATIVE`. v7.28.3's own system prompt says: *"One format, every response — there
   are no modes. Modes, tiers, routing, and per-mode templates were retired 2026-07-11."*
   v7 scored 0% for not emitting something it deliberately deleted.

Faults 2 and 3 compound: with no Algorithm to load, L7 went looking for one outside its
sandbox, which is fault 1. The headline "upstream fires 0% on Sonnet" is retracted.

## What changed in the harness

| Concern | Mechanism | Verified by |
|---|---|---|
| Fidelity | `$HOME` → `sandboxes/_home/<VERSION>`, whose `.claude` points at the staged install | probe: `~/.claude/CLAUDE.md` returns `# LifeOS 7.28.3 …` |
| Safety | `sandbox-exec` seatbelt denying the operator home | Read tool **and** Bash `cat` on a planted canary → `BLOCKED` |
| Validity | `LeakCheck.ts` marks any escape `contaminated`; fleet withholds the report | catches the archived polluted lane; clean on new cells |
| Install completeness | per-version `system_prompt` → `--append-system-prompt-file`; missing file is a hard error | L7 now emits `════ LifeOS ═══` |
| Identity imports | each version's **own** `ActivateImports.ts`, not a reimplementation | all 5 imports activate on v6 and v7 |
| Provenance | exact argv recorded in `meta.json` | the missing flag was invisible because nothing wrote down what ran |
| Routing | `code:algorithm_read` — did it read the Algorithm before substantial work | version-neutral; v5/v6/v7 all instruct the same read |
| Format | `code:format_compliance`, separate column | a version can honour its format contract and have no modes |

**Persona.** Bruce Wayne / Alfred, disjoint from the operator by construction — which makes
the operator's own identifiers a continuous tripwire. `fixtures/_persona/blocks/` is the
single source; `StagePersona.ts` renders it into all three install layouts byte-identically.

**Matrix.** FORK is retired. It required withheld transcripts, and the publishable question
is whether the framework helps, not whose fork is better.

## Phase 4 — the measurement run (560 cells)

Golden set **2.0.0**. Deliberate break; no comparability with anything prior.

| Version | Models | T1–T4 | T5 | Total |
|---|---|---:|---:|---:|
| RAW | all 8 | 192 | 20 | 212 |
| L5 (v5.0.0) | sonnet-5, terra | 48 | 20 | 68 |
| L6 (v6.0.5) | sonnet-5, terra | 48 | 20 | 68 |
| L7 (v7.28.3) | all 8 | 192 | 20 | 212 |

`models_allowlist` (per version) and `tier_models` (per tier) keep the bisect from paying for
the full model sweep. Three questions, each with the cheapest matrix that answers it:

- **Q1 — did LifeOS regress? (#1715)** All four versions × 2 models. Compare `algorithm_read`,
  format compliance, and task pass-rate across v5 → v6 → v7.
- **Q2 — the scaffolding inverted U.** RAW vs L7 × all 8 models, Opus 5 and Opus 4.8 included.
  Opus 4.8 tests whether previous-generation frontier behaves scaffold-indifferent (like
  current frontier) or scaffold-helped (like mid-tier) — the "it worked better on older
  models" claim.
- **Q3 — does the scaffold use the user?** T5 × 4 versions × 2 models. RAW is the floor: it
  structurally cannot know the persona, so its grounding checks `skip` rather than fail.

### Suggested wave order

Resume-safe throughout; `Fleet.ts` skips cells whose `meta.json` says `success` and retries
anything marked `contaminated`.

A wave is a **(versions × models)** selection, not a version selection: Waves B and C share
their versions and differ only by model, so `Fleet.ts` takes `--versions` *and* `--models`.

1. **Wave A — bisect (136 cells):** L5 + L6, both bisect models, all tiers. Answers Q1's hard
   half and exercises the two least-tested staging paths first.
2. **Wave B — RAW + L7 core (136 cells):** both bisect models, all tiers. Completes Q1 and Q3.
3. **Wave C — model sweep (288 cells):** RAW + L7 × the remaining six models, T1–T4 only
   (T5 is restricted to the two bisect models by `tier_models`). The expensive one; Opus lanes
   live here. Split across subscription windows.

136 + 136 + 288 = 560. (Earlier drafts labelled these 48 and 376, which matched neither the
prose above nor the enumerated matrix.)

### Launch

```bash
cd ~/live/projects/lifeos-bench
git pull
bun tools/StageVersion.ts RAW --force   # and L5, L6, L7
bun tools/Fleet.ts --dry-run | wc -l    # must print 560

# A wave is (versions x models). Waves B and C share versions, so --models is required
# to separate them; --versions alone would run 424 cells instead of 136.
FLEET_VERSIONS=L5,L6 FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &          # Wave A
FLEET_VERSIONS=RAW,L7 FLEET_MODELS=sonnet-5,gpt-5.6-terra ... nohup tools/fleet-overnight.sh & # Wave B
FLEET_VERSIONS=RAW,L7 FLEET_MODELS=fable-5,haiku-4-5,gpt-5.6-luna,gpt-5.6-sol,opus-5,opus-4-8 \
  FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &                              # Wave C
```

Claudex lanes (terra/luna/sol) additionally need CLIProxyAPI up on `:8317` and signed in.

Re-running the same command after a wave is the resume sweep: `Fleet.ts` skips cells whose
`meta.json` says `success` and retries everything else, so stragglers need no special handling.

### After the runs

Cross-vendor blinding needs one pass per vendor — `JUDGE_CMD` is a single template, so
`--model` selects which cells each judge sees.

```bash
JUDGE_CMD='bun <CodexExec path> --model gpt-5.6-terra --prompt-file {promptfile}' \
  bun tools/Judge.ts --model sonnet-5,fable-5,haiku-4-5,opus-5,opus-4-8   # Claude cells -> GPT
JUDGE_CMD='bash tools/claude-judge.sh {promptfile}' \
  bun tools/Judge.ts --model gpt-5.6-terra,gpt-5.6-luna,gpt-5.6-sol       # GPT cells -> Claude
bun tools/Report.ts
```

`tools/claude-judge.sh` runs the Claude judge with an empty config **and** a neutral cwd. Both
are load-bearing: without them it loads the operator's real install and grades synthetic-persona
answers against the operator's actual profile, failing correct answers as ungrounded.

Judges stay blinded and cross-vendor: Claude-family cells judged by GPT, GPT cells by Claude.
`scrubResponse` strips banner lines before the judge sees anything; its `BLINDING_MARKERS`
already covers `═══`, `LifeOS`, `♻`, and the `🗣️` closer, so v5/v6/v7 formats are all
stripped. Re-check it if any version's banner changes.

## Phase 4 scaffolded lanes were invalid — re-run DONE 2026-08-10 (found 2026-08-10)

> Resolved. Kept in full because it is the study's central correction, not because it is pending.
> The re-run's outcome is under **Final results** below; what follows is how the fault was found.

The routing investigation below turned up something larger than routing. The seatbelt's home
read-deny emptied `process.env` for **every** Bun process whose cwd sat inside the operator home,
and every scaffold hook is `#!/usr/bin/env bun`. So the whole hook layer of every scaffolded
version was non-functional for the entire run:

| Version | Hooks registered | Cells recording hook failures |
|---|---:|---:|
| RAW | 0 | 0 / 212 |
| L5 | 34 | 66 / 68 |
| L6 | 60 | 67 / 68 |
| L7 | 51 | 210 / 212 |

The prompt-and-context half of each scaffold worked throughout — the system prompt arrives by CLI
flag, `CLAUDE.md` and its `@`-imports by file read, and L7 does emit its banner. What was switched
off is the enforcement half. Phase 4 therefore measured *scaffold-minus-hooks*, which for a
framework built on "code before prompts" understates it, and in an unknown direction for format
compliance and task pass-rate alike.

**Consequence for the numbers below: RAW-only figures stand; every L5/L6/L7 figure, and every
RAW-vs-L7 delta, needs the re-run.** The harness fix is in (`Sandbox.runWorkspace`), so the re-run
is the existing wave commands with no new flags. This supersedes items 4–7 of Phase 5 in priority —
confirming a number five times is worthless if the lane that produced it was mis-configured.

## Phase 4 base results (scaffolded lanes re-run 2026-08-10, judged 2026-08-10)

> This is the 560-cell base matrix. The subsequent L6 six-model sweep is a Phase 5 outcome,
> recorded below; it raises the cumulative artifact set to 704 cells.

**560/560 cells, 559 `success`, containment clean (18827 files, 0 violations — and 0 for each live
lane scanned alone: RAW 5051, L5 3338, L6 2137, L7 8293), 220 rubric verdicts, zero judge errors,
zero rows unjudged.** Every scaffolded cell ran with a working hook layer, evidenced per cell
(L5 24.0, L6 21.8, L7 25.4 hook-state files written per cell; RAW zero). Recorded cost $359.37
across 17.1 h of cell wall-clock.

**Containment-gate hygiene, fixed 2026-08-10.** The retired FORK lane's per-cell artifacts were
still sitting inside `results/` (`phase1/FORK/`, and a `phase1-polluted/FORK/` tree from the
retracted phases). Those derive from a private scaffold that legitimately contains the operator's
real identity, so a full-tree scan reported **101 violating files — every one of them FORK, none
in any live cell.** That is not a sandbox escape; it is a retired lane's own content sitting where
the gate looks. Both trees are now quarantined under `_archive/fork-retired-2026-08-10/`, which is
what `.gitignore` already says `_archive/` is for ("quarantined out of results/ so the fleet
containment gate scans only live cells"). The fix is a move, not a code change — **no exemption
was added to `LeakCheck`**, because an exemption is exactly how a gate stops meaning anything.

Numbers: `results/phase1/REPORT.md`, `docs/report-data.json`, `docs/report.html`. **Everything in
the Phase 4 section below is superseded** and retained only as the history of how it was wrong.

Three grader defects were found while regenerating, all one-directional, all now fixed with
regression tests and listed in `README.md` → Grader integrity:

- **Algorithm entry was averaged with Algorithm skip.** `code:algorithm_read` asks opposite
  questions on opposite prompts — enter the Algorithm for heavy work, stay out of it for trivial
  work. Every version passes the skip checks, so the combined column dragged a near-zero entry rate
  up to a passing-looking 40–50% and hid the largest effect in the dataset. Now split on the golden
  set's own `expect` field: **L5 enters on 5–6 of 6 heavy prompts; L6 0 of 6 (hook confounded); L7
  gets 0 of 6 on four Claude models, 1 of 6 on Fable 5, and 6 of 6 on every GPT model.**

- **A `skipped` grader counted as a task failure.** The golden set skips checks that cannot apply
  to a version — RAW's T5 grounding — so a documented exemption became a penalty, and only the
  control was ever exempt.
- **Prompts a lane never ran counted against it.** `tier_models` restricts T5 to the two bisect
  models, but pass@k divided by all 21 prompts regardless, so six of eight model lanes were
  graded on five prompts never sent to them. Worth up to 23.8 points per lane, and the sole
  source of the Phase 4 headline "no model passes 100% bare".

### What the judged data says

**On T1–T4 the scaffolding does not help.** Bisect models, four non-personalization tiers:

| Version | T1–T4 pass@k | T1–T4 pass^k | Mean output tokens/cell |
|---|---:|---:|---:|
| RAW | **96.9%** | 93.8% | 2.8k |
| L5 | 96.9% | 90.6% | 10.9k |
| L6 | 93.8% | 93.8% | 2.0k |
| L7 | 90.6% | 87.5% | 2.9k |

The Phase 5 L6 six-model sweep changes that reading: across all eight models, RAW/L6/L7 are
96.1%/91.4%/93.0% pass@k on T1–T4; in the six added models alone they are 95.8%/90.6%/93.8%.
It reverses the L6/L7 order from the two-model bisect rather than confirming a monotone ladder.
Within a lane, the 1–2 trial design remains noisy (one prompt = 4.8–6.3 points).

**On T5 it is decisive.** RAW 40.0% pass@k / 10.0% pass^k; L5 100/60, L6 90/70, L7 90/60. Large,
consistent across versions and models, and close to tautological — the control structurally
cannot know the persona. What it establishes is that the delivery mechanism works.

**RAW vs L7 per model (pass@k):** sonnet-5 +14.3, opus-4-8 +6.3, fable-5 / haiku-4-5 / terra /
luna 0.0, opus-5 −6.2, sol −12.5. Does not sort by model tier; only the outer two are outside the
noise band.

**Cost separates the versions cleanly.** L5 is ~10.9k output tokens/cell; after the L6 sweep,
L6 is 3.0k and L7 2.9k, for a task pass-rate inside the noise band. Format compliance moves the
other way: L5 70% → L6 100% → L7 96.4% (the last dragged down entirely by Haiku 4.5 at 66.7%).

**Both retracted Phase 1–3 headlines still fail, and one Phase 4 headline joins them.** "Frontier
models pass 100% bare" is *partly rehabilitated* — four of eight models do reach 100% pass@k bare
on the prompts they ran — but not as originally argued, and Phase 4's counter-claim that nothing
exceeds 85.7% bare was a grader artifact. "Small models get worse under scaffolding" still does
not reproduce: Haiku 4.5 is flat on pass@k and pays its cost in format compliance.

## Phase 4 results — all three waves (run 2026-08-09, SUPERSEDED — hooks were off)

**560/560 cells run, 559 `success`, containment clean, zero pending judges.** Numbers in
`results/phase1/REPORT.md`. The single failure is `RAW/opus-5/t4-casual-complex/trial-2`, a
reproducible 1200s timeout (it failed twice, the second time on an idle machine) — recorded as a
timeout rather than rescued by raising the ceiling mid-analysis.

Eleven harness and grader defects were found and fixed during the run, each with a regression
test; the per-defect list is in `README.md` → Grader integrity.

### Q2 — does the scaffolding help? (RAW vs L7, pass@k)

| Model | RAW | L7 | Δ |
|---|---:|---:|---:|
| sonnet-5 | 76.2 | 95.2 | **+19.0** |
| opus-4-8 | 66.7 | 76.2 | **+9.5** |
| haiku-4-5 | 66.7 | 71.4 | **+4.7** |
| fable-5 · opus-5 · terra · luna · sol | — | — | 0.0 |

Helps or is neutral on seven of eight models. On pass^k only `fable-5` declines (−4.8, one prompt).

**Both retracted Phase 1–3 headlines fail on corrected data.** "Frontier models pass 100% bare"
is gone — nothing exceeds 85.7% without a scaffold, so that ceiling was an artifact of the old
prompt set, not a property of the models. "Small models get worse under scaffolding" does not
reproduce either: Haiku 4.5 *gains* (+4.7 pass@k, +9.6 pass^k). It pays its cost in format
compliance (66.7% vs 100% everywhere else), not in task success. The curve is diminishing
returns toward current frontier, not an inverted U.

Cost: L5 spends 7.7k–8.5k output tokens per cell; every other version runs 1.6k–4.1k for
comparable or better pass-rates.

### The routing metric did not survive contact with the harness

**Correction (2026-08-10).** The Phase 4 write-up said "Claude Code spawns hook subprocesses with
an EMPTY environment." That is false, and it was believed for a whole wave. A `/usr/bin/env` probe
registered as a real hook, inside a real cell, prints **121 variables** with correct `HOME`,
`PATH` and `CLAUDE_CONFIG_DIR`. Two things were also conflated: **only v6 ships a router hook.**
v7.28.3 retired modes and registers no `TheRouter.hook.ts` at all, so an "L7 routing" figure was
never a measurement of routing in the first place.

**Real cause #1 — the seatbelt, via Bun, via cwd (fixed).** In the *same* hook invocation where
`/usr/bin/env` prints 121 variables, a `bun` process prints `Object.keys(process.env).length === 0`.
Bun reads something under the operator home during startup; the profile's
`(deny file-read* (subpath <realHome>))` refuses it, and Bun silently yields an empty environment
instead of failing. Every scaffold hook is `#!/usr/bin/env bun`, so all of them ran with no `PATH`,
and v6's router `spawn('claude')` failed with `Executable not found in $PATH: "claude"` and
fail-safed to NATIVE on every prompt.

The trigger is **cwd alone** — not `claude`, not `HOME`, not the config root. Reproduced with no
`claude` anywhere in the chain: same profile, same environment, cwd inside the denied tree → 0
variables; cwd under `/private/tmp` → 119. Removing the read-deny fixes it; removing the
write-deny does not. Cells now run with their working directory outside the operator home
(`Sandbox.runWorkspace`) and the workspace is copied back beside its artifacts afterwards. The
boundary is unchanged — the operator home stays denied — and the router now reaches its classifier
(1.9s, real API call) instead of failing to find a binary.

**Real cause #2 — no credentials for the nested call (open, see Phase 5).** With the environment
fixed, v6's router now fails one layer later: `api error: claude JSON envelope is_error=true`.
Claude Code does not pass `CLAUDE_CODE_OAUTH_TOKEN` into hook subprocesses (confirmed: no auth
variable of any kind appears in the hook's 121), and the sandbox `HOME` deliberately contains no
credentials — "nothing credential-bearing is placed in a sandbox" is a stated isolation invariant,
and reachable in-sandbox credentials are a defect this harness already fixed once. On a real user's
machine the nested `claude` authenticates from the real home, which is exactly why these hooks work
for users and not here. Measuring hook-based routing therefore requires a deliberate decision about
putting a credential inside a `bypassPermissions` sandbox.

Previously ruled out with direct probes, each: hooks not firing headless, hook timeout (5s vs 35s),
`CLAUDECODE`, `settings.env` injection, an ephemeral `cmux` PATH shim, seatbelt exec denial (`bun`
and a nested `claude -p` both execute inside the profile), and a sandbox-local `bin/claude` shim
verified first on PATH and runnable. All of those were correct rejections; the missed variable was
cwd.

Consequence for the Phase 4 numbers: `algorithm_read` for L6 measures **unrouted model behavior**,
not routing design, and for L7 it measures a version that has no mode/Algorithm classifier by
design (its six UserPromptSubmit hooks are deterministic and none routes). Do not report
either as a scaffold regression. L5 is unaffected because v5 routes via prose in `CLAUDE.md` — no
subprocess, nothing to spawn. That asymmetry is itself the interesting result: prose routing
survives an environment where hook-based routing cannot run.

What the L7 routing column *does* show, read correctly: 40% on four Claude models, 50% on Fable 5,
and 100% on all three GPT models. That is unrouted instruction-following — GPT models read the
Algorithm because the system prompt says to; Claude models mostly do not.

## Phase 5 — hardening

### L6 six-model sweep — done 2026-08-10

The sweep adds the six non-bisect models to L6 (144 cells), completing L6 across all eight models.
The cumulative artifacts now record **704 cells: 703 `success`, 1 `timeout`, 262 rubric verdicts,
$474.63 recorded cost, and 20.38 h wall-clock**. On T1–T4, all-eight RAW/L6/L7 pass@k is
**96.1% / 91.4% / 93.0%**; the six added models alone are **95.8% / 90.6% / 93.8%**. The extra
samples therefore **moved** the apparent bisect ladder: L6 falls below L7 instead of preserving the
prior 93.8% vs 90.6% ordering.

L6 Algorithm entry remains **0 of 6 on all eight models**. This is not a regression result: L6
routes through a nested `claude`, and the sandbox deliberately provides no credentials, so that
nested call cannot authenticate. It measures unrouted model behaviour under this harness.

**This does not change the gating item:** five-trial confirmation of the RAW-vs-L7 outliers remains
first — sonnet-5 (+14.3) and gpt-5.6-sol (−12.5).

**Items 1–4 are done.** Their outcomes are recorded inline rather than deleted, because two of
them (the credential decision, the hook re-run) are permanent constraints on how any future result
here must be read. Items 5–8 remain and were re-ordered against the judged data — see
*What remains* below.

1. ~~**Isolate the empty-hook-environment cause.**~~ **Done 2026-08-10 — and the premise was
   wrong.** Claude Code does not empty the hook environment. The cause was the seatbelt read-deny
   breaking Bun whenever cwd sat inside the operator home; cells now run outside it. See the
   correction above. What remains is a decision, not an investigation:

   **1a. Credential decision — MADE 2026-08-10: credentials stay out.** Hook-based routing is a
   permanent limitation of this method, reported as such rather than bought with a security
   regression. The options were: v6's router now reaches its classifier and
   fails on authentication: Claude Code passes no auth variable to hooks, and the sandbox `HOME`
   holds none by design. Three options, all with real costs:
   - **Keep credentials out (status quo).** Hook-based routing is structurally unmeasurable here;
     report it as a permanent limitation of the method and publish v5-vs-v6 prose-routing only.
   - **Inject a token via the staged `settings.json` `env` block** (verified to reach hooks — it
     is how `CLAUDE_CODE_FORK_SUBAGENT` arrives). Measures the real thing, but re-opens
     "real OAuth credentials reachable in-sandbox", a defect this harness explicitly fixed, in
     cells running `--permission-mode bypassPermissions` with network access.
   - **Point the nested call at a local relay** the way the claudex lanes already point
     `ANTHROPIC_BASE_URL` at `127.0.0.1:8317` with a worthless local key. Keeps real credentials
     out of the sandbox; costs a build, and changes what the nested call talks to.

   If routing stays unmeasurable, the fallback of patching the staged `Inference.ts` to spawn an
   absolute binary path is now known NOT to help — the binary was always findable; the environment
   was not. Do not spend on it.
2. ~~**Re-judge the void T5 rows.**~~ **Done 2026-08-10.** Every T5 verdict in Waves A/B predated
   the judge receiving the persona, so `grounding_quality` was graded against materials the judge
   could not see. The scaffolded lanes' rows went with their re-run; RAW's 20 T5 rows carried no
   timestamp, so "written after the fix" could not be proven per row and they were dropped
   wholesale (backup: `_archive/judge-grades-preT5rejudge-2026-08-10.jsonl`) and re-judged with
   the rest. **164 rows judged in two cross-vendor passes, zero judge errors, zero rows left
   pending.** Note for anyone reconciling counts: the pending-row figure quoted before this ran
   (146) counted raw JSONL lines; deduped latest-wins it was 144 scaffolded + 20 RAW = 164.
3. ~~**Decide the Chrome-denial contamination semantics.**~~ **Done 2026-08-10 — narrowed.**
   `LeakCheck` now exempts an escape-pattern hit when the SAME line carries an explicit refusal
   marker (`Operation not permitted`, `deny(1)`, `EPERM`, …). Safe by construction: a successful
   read produces no refusal marker, so no real escape can hide behind it, and identity tokens are
   never exempted. Note the premise had thinned — only one cell was ever lost to this
   (`RAW/gpt-5.6-sol/t4-casual-complex/trial-1`) and a retry cleared it, so the change is
   insurance for the re-run rather than a fix for a live failure.
4. ~~**Re-run the scaffolded lanes (348 cells).**~~ **Done 2026-08-10 — all 348 `success`.**
   L5 68 + L6 68 + L7 212, every cell with a working hook layer and per-cell evidence of it
   (`meta.hook_state`: L5 24.0, L6 21.8, L7 25.4 files written per cell). Phase 4's L5/L6/L7
   artifacts are archived under `_archive/prehooks-phase4-2026-08-10/` (with their judge rows);
   RAW's 212 cells are untouched and still valid. The account of how it was found and fixed
   follows, because it is the credibility story rather than a changelog entry.

   **Turning the hooks on took three fixes, not one — each of the first two hid the next.**
   Fix 1 was the cwd/`process.env` fault (`Sandbox.runWorkspace`). Fix 2 was install completeness:
   no staged install had `node_modules`, so any hook reaching `yaml` died on
   `bun is unable to write files to tempdir` (`StageVersion.installDependencies`). Neither made the
   layer work; they only exposed fix 3.

   **Fix 3 — the staged home was shared, so hooks leaked state between cells** (found 2026-08-10,
   on the first cells that ran with a working hook layer). Hooks write runtime state to
   `$HOME/.claude/...`, and every cell in a lane pointed at the same staged tree. L7 wrote 29 files
   there per cell — `drift-reminder.json`, `work.json`, `review-state.json`, `session-names.json`,
   all of which feed the next session's context — and v5's settings hooks rewrote the staged
   `settings.json` itself, the file every later cell in that lane loads. Under `concurrency: 4` they
   also raced for those files. This falsified the independence claim `bench.config.json` makes to
   justify concurrency ("the staged config root is not written at runtime").

   It hid behind a version difference: v6 resolves `LIFEOS_DIR="$HOME/…"` literally and drops a
   per-cell `$HOME/` directory into the cwd (inert, and already handled by `Grade.isScaffoldState`),
   while v7 patched that expansion (#1404) and therefore writes to the real — shared — home.

   Every cell now clones the staged tree into its own `$HOME` (`Sandbox.prepareCellHome`, `cp -c`:
   ~0.5s for 26MB, no extra disk), and the seatbelt no longer re-allows the template, so the blanket
   operator-home deny refuses any write to it. Verified: L7 and L5 probe cells succeed with the
   staged trees byte-identical afterwards. Each cell now also records what its hooks wrote
   (`home-writes.txt`, `home-state/`, `meta.hook_state`) — 28 scaffold files for an L7 cell, 9 for
   an L5 cell — so a dead hook layer is visible in the artifacts instead of needing a fresh probe.

   **The re-run is 348 cells: L5 68 + L6 68 + L7 212.** L5's Phase-4 lane had already been re-run
   once under fixes 1-and-not-2; scanning all 68 of those transcripts found zero `tempdir` and zero
   module-resolution failures, which confirms the "v5 never reaches a `yaml` import" hypothesis was
   right — but they were archived and re-run anyway (`_archive/nodeps-rerun-2026-08-10/`) so all
   three scaffolded lanes share one staging provenance. The nine cells run under the shared home are
   archived as evidence in `_archive/sharedhome-2026-08-10/`.

   **RAW's 212 Phase 4 cells are retained**, on an argument that must be stated rather than assumed:
   a version that registers no hooks has nothing writing to `$HOME` at runtime, so what RAW's shared
   home accumulated was Claude Code's own bookkeeping (`.claude.json`, per-cwd `projects/` session
   logs, telemetry caches), and every cell already had a unique cwd, so no session was resumed into
   another cell. If that argument is ever doubted, the fix is to re-run RAW (212 cells), not to
   hedge the number.

### What remains, re-ordered by what the judged data justifies

5. **5-trial confirmation — still the gating item.** The completed L6 sweep moved, rather than
   confirmed, the two-model version ladder: all-eight T1–T4 pass@k is RAW/L6/L7
   96.1/91.4/93.0, while the six added models are 95.8/90.6/93.8. It does **not** change the
   required gate: run five trials of **RAW vs L7 on the two outlier models**, sonnet-5 (+14.3) and
   gpt-5.6-sol (−12.5), before promoting either difference.

   **Remaining-work order:** (1) that five-trial outlier confirmation; (2) raise the judge's
   discriminative power; (3) check cross-vendor judge agreement; (4) conditionally bisect format
   compliance. ~~`routed_heavy` / `algorithm_entered`~~ remain obsolete confirmation targets:
   L7 has no classifier by design and L6's nested `claude` cannot authenticate without sandbox
   credentials, so further trials would only tighten an unrouted-behaviour measurement.

6. **Raise the judge's discriminative power — cheapest remaining win, and it needs no new judge
   calls.** Scores are recorded, so the threshold is a re-analysis, not a re-run. On the current
   262 verdicts: `min_score` 3 → 224 pass; 4 → 183 (41 verdicts flip); 5 → 143. The threshold
   moves absolute pass-rates by more than most version differences here, which is the actual
   complaint.

   Sharpening the rubrics is the better fix and this run produced the evidence for it: a
   `t5-conflict` verdict scored 3 and **passed** while its own reasoning states the response "does
   not acknowledge the standing TypeScript/Bun preference" — the precise thing the rubric asks
   about. That closes the standing open item below: the judge is *not* strict about
   acknowledgement at a 3-of-5 bar. Either the rubric must make acknowledgement a floor rather
   than a dimension, or `min_score` for that expectation must be 4.
7. **Judge agreement check:** re-judge a sample with the alternate vendor and record disagreement
   rather than averaging it. Unchanged in priority — but note the score distribution is bimodal
   (143 fives, 36 ones, 83 in between of 262), so a disagreement study should sample the middle
   deliberately rather than uniformly.
8. **Conditional bisect narrowing — now answerable, and mostly negative.** Q1 shows **no cliff in
   task pass-rate** between adjacent versions (T1–T4: 96.9 → 93.8 → 90.6; T5: 100 → 90 → 90), so
   the conditional does not fire for that metric and intermediate tags would buy nothing. It
   *does* fire for **format compliance**, where L5 → L6 is a genuine step (70% → 100%) — if
   anything gets bisected, it is that, on format graders only, sonnet only.

## Phase 6 — shipping

- **The #1715 write-up.** Methods, findings, and an explicit account of what Phases 1–3 got
  wrong and how it was caught — the correction is more credible than the result.
- **Upstream bug reports:** the macOS file case-collision (`ISAReconcile.ts` /
  `IsaReconcile.ts`, present in both v6 and v7); that `LATEST` holds a bare version while
  the file carries a `v` prefix, which silently breaks any `@`-import built from it; and the
  **memory-health false alarm** — `MemoryHealthCheck` treats `settings.system.json` as the source
  of truth while `InstallHooks` merges `install/hooks/hooks.json` into `settings.json` only, and the
  shipped `install/settings.system.json` registers none of the memory hooks. A fresh v6/v7 install
  therefore reports its own (correctly registered, actually running) hooks as missing, and the
  `🩺 MEMORY HEALTH: CRITICAL` banner reaches the model's context and its answers. Affects both
  versions; observed in every scaffolded cell.
- **Also worth reporting, lower severity:** the tab-setter hook shells out to `cmux` unconditionally
  and logs a stack trace when it is absent or has no session — noise on every hook invocation in any
  environment without it.
- **Repo publication gate:** the repo is private pending review. Before it goes public again,
  re-run `LeakCheck` over the full tree, confirm no transcript names a real person, and get
  a decision on the DC-trademark persona.
- **Standing regression suite:** scheduled run of the frozen golden set against each new
  release tag and model id, alerting on deltas. The end state is a tripwire, not a study.

## Known open items

- ~~`t5-conflict` — confirm the judge is strict about acknowledgement.~~ **Answered 2026-08-10:
  it is not.** A verdict scored 3 and passed while its own reasoning says the response "does not
  acknowledge the standing TypeScript/Bun preference". `helper_produced` accepts any language by
  design and the rubric was supposed to carry the judgement; at a 3-of-5 bar it does not. Fix
  routes through Phase 5 item 6.
- ~~T5 rows judged before 2026-08-09 are void.~~ **Closed 2026-08-10** — all re-judged with the
  persona supplied; see Phase 5 item 2.
- **Cells can act on the host outside the seatbelt.** A cell that renders a page launches a
  browser through the OS, which is not inside the profile; leftover tabs pointing at cell
  workspaces were found in the operator's browser session after the run. Nothing flows back into
  the cell and containment scans clean, so validity is unaffected — but "the cell cannot affect
  the host" is not a claim this harness can make, and it belongs in the write-up's threat model.
- **Version-level roll-ups mix lane sets.** RAW and L7 have eight lanes; L5 and L6 have two. A
  version's overall `task_at_k_pct` is therefore not comparable across versions — use the
  bisect-model tables, or the per-model deltas.
- RAW rows show `—` for routing and format by construction, not by missing data.
- `results/phase1/` path name is now historical; runs land there regardless of phase.
