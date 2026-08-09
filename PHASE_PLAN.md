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

1. **Wave A — bisect (136 cells):** L5 + L6, both models, all tiers. Answers Q1's hard half
   and exercises the two least-tested staging paths first.
2. **Wave B — RAW + L7 core (48 cells):** both models, all tiers. Completes Q1 and Q3.
3. **Wave C — model sweep (376 cells):** RAW + L7 × the remaining six models. The expensive
   one; Opus lanes live here. Split across subscription windows.

### Launch

```bash
cd ~/live/projects/lifeos-bench
git pull
bun tools/StageVersion.ts RAW --force   # and L5, L6, L7
bun tools/Fleet.ts --dry-run | wc -l    # must print 560
FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &
```

Claudex lanes (terra/luna/sol) additionally need CLIProxyAPI up on `:8317` and signed in.

### After the runs

```bash
JUDGE_CMD='bun <CodexExec path> --model gpt-5.6-terra --prompt-file {promptfile}' bun tools/Judge.ts
bun tools/Report.ts
```

Judges stay blinded and cross-vendor: Claude-family cells judged by GPT, GPT cells by Claude.
`scrubResponse` strips banner lines before the judge sees anything; its `BLINDING_MARKERS`
already covers `═══`, `LifeOS`, `♻`, and the `🗣️` closer, so v5/v6/v7 formats are all
stripped. Re-check it if any version's banner changes.

## Phase 5 — hardening

- **5-trial confirmation** on every cell a headline rests on. With one trial, format
  compliance already varied run to run on the same lane — that variance is a finding, and it
  means single-trial headline numbers are not publishable.
- **Grader audit pass** on a sample of both passing and failing cells. This session found two
  broken graders by auditing surprising numbers; assume more.
- **Conditional bisect narrowing:** only if Q1 shows a cliff between two adjacent versions,
  add intermediate tags, routing tiers only, sonnet only.
- **Judge agreement check:** re-judge a sample with the alternate vendor and record
  disagreement rather than averaging it.

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
- RAW rows show `—` for routing and format by construction, not by missing data.
- `results/phase1/` path name is now historical; runs are Phase 4 but land there.
