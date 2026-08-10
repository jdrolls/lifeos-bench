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

## Phase 4 results — all three waves (run 2026-08-09)

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

L6 and L7 route through an LLM-backed classifier hook (`TheRouter.hook.ts`). It *runs* inside
cells, and returns a correct `MODE: ALGORITHM | TIER: E3` when invoked standalone — even under the
seatbelt, in 5s against its own 35s timeout. Inside a cell it never delivers a decision.

**Root cause: Claude Code spawns hook subprocesses with an EMPTY environment.** Measured from
inside the hook process: `{"HOME": null, "PATH": "", "CLAUDE_CONFIG_DIR": null}` — zero variables.
`$HOME` is expanded in the *command string* (which is why the hook file is found at all) but
nothing is passed through. With no `PATH`, upstream's `spawn('claude')` fails with
`Executable not found in $PATH: "claude"`, the router fail-safes to NATIVE on every prompt, and
the model never enters the Algorithm. The same cause explains the SessionEnd hooks that crash on
`process.env.HOME!` — those were the visible edge of it, initially dismissed as cosmetic.

Ruled out with direct probes, each: hooks not firing headless (a marker hook fires), hook timeout
(5s vs 35s), `CLAUDECODE` (upstream clears it), credentials in-sandbox, `settings.env` injection,
an ephemeral `cmux` PATH shim, seatbelt exec denial (`bun` and a nested `claude -p` both execute
inside the profile), and a sandbox-local `bin/claude` shim verified first on PATH and runnable.

Consequence: `algorithm_read` for L6/L7 measures **unrouted model behavior**, not routing design.
Do not report "L6 never enters the Algorithm" as a scaffold regression. L5 is unaffected because
v5 routes via prose in `CLAUDE.md` — no subprocess, nothing to spawn. That asymmetry is itself the
interesting result: prose routing survives an environment where hook-based routing cannot run.

What the L7 routing column *does* show, read correctly: 40% on every Claude model, 100% on all
three GPT models. That is unrouted instruction-following — GPT models read the Algorithm because
the system prompt says to; Claude models mostly do not.

## Phase 5 — hardening

Ordered. (1) gates the routing half of the study; (2) and (3) are cheap and unblock T5; the rest
is confirmation work.

1. **Isolate the empty-hook-environment cause.** Everything L6/L7 routing rests on is blocked
   behind this. Open leads: whether Claude Code passes hook env differently by invocation shape or
   version; whether upstream's own `lifeos` launch command (Setup step 8.5) changes it; and
   comparing against a real interactive session, where upstream's hooks demonstrably work — that
   contrast is the strongest clue, since these hooks are not broken for real users.
   Fallback if it proves unfixable: patch the staged `Inference.ts` to spawn an absolute binary
   path. That modifies the artifact under test and must be declared loudly in the methods.
2. **Re-judge the void T5 rows.** Every T5 verdict in Waves A/B was produced before the judge
   received the persona, so `grounding_quality` was graded against materials the judge could not
   see — two cells citing the identical real fact got opposite verdicts. `Judge.ts` now supplies
   it; the old rows must be dropped from `judge-grades.jsonl` and re-judged.
3. **Decide the Chrome-denial contamination semantics.** Cells that build a page launch real
   Chrome, whose crashpad probes the operator's profile and is refused. `LeakCheck` counts that
   denial as an escape, invalidating a cell whose boundary actually *held*. Either narrow the
   detector to ignore explicit denial records, or keep the strict rule and accept the loss — but
   decide deliberately rather than by default.
4. **5-trial confirmation** on every cell a headline rests on. Priority order from observed
   variance: `routed_heavy` (L5/terra 2/2 vs L5/sonnet 0/2 on the same scaffold), then format
   compliance, then `algorithm_entered`.
5. **Raise the judge's discriminative power.** `min_score` is 3 of 5 and ~68% of scores are 5s, so
   task pass-rate separates versions weakly. Either raise the threshold or sharpen the rubrics.
6. **Judge agreement check:** re-judge a sample with the alternate vendor and record disagreement
   rather than averaging it.
7. **Conditional bisect narrowing:** only if Q1 shows a cliff between two adjacent versions, add
   intermediate tags, routing tiers only, sonnet only.

## Phase 6 — shipping

- **The #1715 write-up.** Methods, findings, and an explicit account of what Phases 1–3 got
  wrong and how it was caught — the correction is more credible than the result.
- **Upstream bug reports:** the macOS file case-collision (`ISAReconcile.ts` /
  `IsaReconcile.ts`, present in both v6 and v7); and that `LATEST` holds a bare version while
  the file carries a `v` prefix, which silently breaks any `@`-import built from it.
- **Repo publication gate:** the repo is private pending review. Before it goes public again,
  re-run `LeakCheck` over the full tree, confirm no transcript names a real person, and get
  a decision on the DC-trademark persona.
- **Standing regression suite:** scheduled run of the frozen golden set against each new
  release tag and model id, alerting on deltas. The end state is a tripwire, not a study.

## Known open items

- `t5-conflict`'s `helper_produced` check accepts any language by design; the rubric carries
  the actual judgement. Confirm the judge is strict about acknowledgement.
- **T5 rows judged before 2026-08-09 are void and need re-judging.** The judge prompt never
  contained the persona, so `grounding_quality` asked it to verify citations against materials it
  could not see; two cells citing the identical real fact got opposite verdicts. `Judge.ts` now
  supplies the persona for T5 judgments, but the existing T5 verdicts predate that fix.
- RAW rows show `—` for routing and format by construction, not by missing data.
- `results/phase1/` path name is now historical; runs are Phase 4 but land there.
