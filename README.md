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
| **Fidelity** | `$HOME` → `sandboxes/_home/<VERSION>`, with the staged install physically at `<HOME>/.claude` so upstream's cross-root relative imports (`../../../.claude/...`) resolve |
| **Safety** | `sandbox-exec` seatbelt denying the operator's home; the child environment is scrubbed of operator paths and ephemeral session shims |
| **Validity** | `LeakCheck` marks any escape `contaminated`; a dirty fleet does **not** get a report |

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
bun test                                   # 54 tests, 0 failures
bun tools/StageVersion.ts L5 --force       # and L6, L7, RAW
bun tools/Fleet.ts --dry-run | wc -l       # 560 = the full matrix

# A wave is (versions x models); Waves B and C share versions and differ only by model.
FLEET_VERSIONS=L5,L6 FLEET_START_EPOCH=$(date +%s) nohup tools/fleet-overnight.sh &

# After a wave, judge cross-vendor, then report:
JUDGE_CMD='bun <CodexExec> --model gpt-5.6-terra --prompt-file {promptfile}' \
  bun tools/Judge.ts --model sonnet-5
JUDGE_CMD='bash tools/claude-judge.sh {promptfile}' bun tools/Judge.ts --model gpt-5.6-terra
bun tools/Report.ts
```

Claudex lanes additionally need CLIProxyAPI up on `:8317` and signed in.

## Status

**Waves A and B complete — 272/272 cells `success`, containment clean, all rubrics judged.**
Full numbers: [`results/phase1/REPORT.md`](results/phase1/REPORT.md). Wave C (288 cells, the
remaining six models) is not yet run.

Findings so far, on the two bisect models:

1. **Scaffolding beats the bare control on task pass-rate.** RAW 76–86% vs L5 100%, L6 95%,
   L7 86–95% pass@k.
2. **Format compliance improves monotonically.** L5 80% → L6 100% → L7 100%.
3. **Cost varies sharply.** L5 spends 7.7k–8.5k output tokens per cell; L6/L7 spend 2.0k–3.1k
   for comparable pass-rates.

## Known limitations

Read these before quoting any number.

- **Routing is not currently measurable for L6/L7.** Both route via an LLM-backed classifier hook.
  The hook runs inside benchmark cells but never delivers a decision, because Claude Code does not
  pass credentials to hook subprocesses and the harness scrubs API keys for billing hygiene. The
  classifier works correctly when run standalone. So `algorithm_read` for L6/L7 measures *unrouted*
  model behavior, not the scaffold's routing design — and must not be reported as a regression.
  L5 is unaffected: v5 routes via prose in `CLAUDE.md`, which needs no subprocess.
- **Single- and double-trial cells are noisy.** Format compliance has been observed varying run to
  run on an identical lane. Headline claims need the Phase 5 five-trial confirmation.
- **The judge bar is permissive.** `min_score` is 3 of 5 with most scores at 5, so task pass-rate
  has weak power to separate versions.
- **Wall-clock is not comparable across runs** at `concurrency > 1`; cells contend for CPU. Token
  counts, routing, format and pass-rates are unaffected.

## Grader integrity

Six harness and grader defects were found and fixed while building this, each with a regression
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

The last one is the instructive case: it was one-directional, so it biased the benchmark toward
its own null hypothesis. It was caught by auditing a result that looked too clean — the bare
control beating a scaffold 4/4 to 0/4.
