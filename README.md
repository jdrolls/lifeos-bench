# lifeos-bench

Reproducible A/B benchmark for AI scaffolding frameworks — built in response to
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715):
*does the scaffolding actually improve outcomes, on which models, at what token cost?*

## What it measures

Three axes, fully crossed:

| Axis | Phase 1 values |
|---|---|
| **Scaffolding** | `RAW` (bare Claude Code, control) · `L7` (upstream LifeOS v7.28.3) · `FORK` (a heavily customized private fork — metrics published, config private) |
| **Model** | Fable 5 · Sonnet 5 (Phase 2: Opus 5, Haiku 4.5, GPT-5.6) |
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

## Status

Phase 1 (144 runs) in progress. Results land in `results/phase1/REPORT.md`.
