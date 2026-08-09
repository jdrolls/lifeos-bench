# lifeos-bench

Reproducible A/B benchmark for AI scaffolding frameworks — built in response to
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715):
*does the scaffolding actually improve outcomes, on which models, at what token cost?*

## What it measures

Three axes, fully crossed — **432 runs complete** across three phases:

| Axis | Values (as run) |
|---|---|
| **Scaffolding** | `RAW` (bare Claude Code, control) · `L7` (upstream LifeOS v7.28.3) · `FORK` (a heavily customized private fork with code-enforced routing — metrics published, config private) |
| **Model** | Fable 5 · Sonnet 5 · Haiku 4.5 (native) · GPT-5.6 terra / luna / sol (same Claude Code harness via a local ChatGPT-auth proxy, so hooks behave identically) |
| **Prompts** | 16 frozen prompts in 4 tiers — simple assistant tasks, medium coding, complex algorithmic work, and routing traps (`goldenset/goldenset.json`) |

Per run we grade, deterministically where possible:

1. **Routing correctness** — did the framework's mode/algorithm fire when it should (and stay
   quiet when it shouldn't)? Graded from transcript markers, per version.
2. **Task pass-rate** — checkable expectations (tests pass, exact outputs, files changed/unchanged),
   pass@k / pass^k across trials.
3. **Overhead** — output tokens and wall-clock per cell.
4. **Quality floor** — LLM-judge rubrics for non-checkable outputs, judged **cross-vendor**
   (a different model family than the one under test; never self-grades).

## Design rules

- Golden set is **frozen before any runs**; changes bump its version and break comparability on purpose.
- Every fixture's baseline behavior is verified against the golden-set expectations before benchmarking.
- Synthetic user profile ("Alex Doe") for every scaffold — no real personal data enters any sandbox;
  the staging tool greps the staged tree and refuses to run on containment violations.
- All prompts run headless in isolated `CLAUDE_CONFIG_DIR` sandboxes with per-run fresh workspaces.

## Layout

```
goldenset/        frozen prompts + expectations
bench.config.json matrix, trials, markers
fixtures/         per-prompt starting workspaces (synthetic)
tools/            StageVersion / RunCell / Grade / Fleet / Report
results/          transcripts + grades.jsonl + REPORT.md (FORK transcripts withheld)
vendor/           upstream checkouts (gitignored)
sandboxes/        staged installs (gitignored)
```

## Status & headline results

**Complete: 432 runs, 105 blinded cross-vendor rubric verdicts, zero unresolved grading errors.**
Full numbers: [`results/phase1/REPORT.md`](results/phase1/REPORT.md).

1. **Enforcement beats prose.** Upstream v7's prose-driven Algorithm fired **0%** of the time on
   Sonnet 5 and 40–60% elsewhere. Code-enforced routing (FORK) hit **100% on four of six models**,
   including all three GPT-5.6 variants — while also passing 100% of tasks on those lanes.
2. **The "Bitter Pill" is an inverted U.** Frontier models (Fable, terra, sol) pass 100% of tasks
   with no scaffold. Mid-tier models (Sonnet, luna) gain real points from scaffolding. Small models
   (Haiku 4.5) get **worse** under both scaffolds — the instruction load eats their capacity.
3. **Cheapest flawless lane:** FORK × GPT-5.6-luna — 100% routing, 100% pass@k, 100% pass^k.
4. **Frameworks can vendor-lock silently:** the fork's model allowlist made it non-portable to GPT
   until stripped; upstream v7.28.3 also ships a macOS file case-collision (`ISAReconcile.ts` /
   `IsaReconcile.ts`).

Run history: Phase 1 = RAW/L7/FORK × Fable + Sonnet (144). Phase 2 = + Haiku 4.5 (72).
Phase 3 = + GPT-5.6 terra/luna/sol through the harness proxy (216). GPT prompt-only lanes were
built, then cancelled — real GPT users of these frameworks run them inside a harness.

## Not yet tested (planned)

- **Version bisect** (the #1715 "old PAI was better" question): LifeOS v5.0.0 / v6.0.5 lanes are
  configured (`phase_reserved`) but **not yet run** — staging support for their install layouts is
  the remaining work.
- **Personalization tier:** current prompts measure task completion and routing only. A T5 tier
  testing whether scaffolds actually *use* the synthetic user's profile (goals, code-style
  preferences, project context) is designed but not yet frozen.
- Opus 5 · 5-trial re-runs on boundary cells · a harder tier to break the 100% ceiling.
