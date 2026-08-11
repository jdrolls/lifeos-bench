# lifeos-bench

A reproducible A/B benchmark for AI scaffolding frameworks, built to answer
[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715): does
scaffolding improve observable outcomes, for which models, and at what measured output volume?

Read the generated reports: [Markdown](docs/report.md) · [HTML](docs/report.html).
Both derive from one report-data contract plus [authored narrative](docs/report-sections.md).

## Bounded findings

- **General single-turn tasks:** no consistent observed improvement in this sample. Across all
  eight models on T1–T4, RAW was 96.1%, L6 91.4%, and L7 93.0% for “succeeded in at least one
  trial.” L5 ran only on the matched Sonnet/Terra pool, where it and RAW were both 96.9%.
- **Synthetic-profile prompts:** a large observed advantage in the five-prompt, two-model test.
  T5 outcomes (at least one / every trial) are RAW 40%/10%, L5 100%/60%, L6 90%/70%, L7 90%/60%.
- **Algorithm-read proxy:** under L7, an Algorithm-directory `Read` was observed in 1/30 Claude
  heavy-task attempts and 18/18 GPT attempts. This does not establish that an Algorithm run began
  first or was followed.
- **Output volume:** on the common 68-cell Sonnet/Terra pool, mean CLI-reported output tokens were
  RAW 1941.1, L5 10906.4, L6 2035.9, and L7 2626.9. L5 generated substantially more output.

The study does **not** test memory, continuity, multi-turn collaboration, accumulated context, or
long-term outcomes. Its judge floor is 3/5, model coverage differs by version, and most cells have
one or two trials. See the report’s confidence box and caveats before quoting a result.

## Reproduce

### Prerequisites

- macOS (`sandbox-exec`), Bun, and Claude Code on `PATH`.
- An OAuth token held outside every sandbox.
- For GPT lanes, a signed-in local ChatGPT-auth proxy.
- Sufficient disk and time for the full 704-cell matrix.

### Vendor the framework payloads

`StageVersion.ts` copies from checkouts supplied locally; it does not fetch them.

```text
vendor/LifeOS-v5/Releases/v5.0.0/.claude   → L5
vendor/LifeOS-v6/LifeOS/install            → L6
vendor/LifeOS/LifeOS/install               → L7
```

Use the pinned payload together with selected upstream activation/hook tools and
harness-managed configuration/dependencies. Do not replace that with an ad-hoc staging layout.

### Run, judge, and report

```bash
bun test
bun tools/StageVersion.ts RAW --force       # Repeat for L5, L6, and L7.
bun tools/Fleet.ts --dry-run                # Inspect the scheduled matrix before running it.

# Run separate configured cross-vendor judge passes; do not let a vendor judge its own output.
JUDGE_CMD='bun <codex-wrapper> --model gpt-5.6-terra --prompt-file {promptfile}' \
  bun tools/Judge.ts --model sonnet-5,fable-5,haiku-4-5,opus-5,opus-4-8
JUDGE_CMD='bash tools/claude-judge.sh {promptfile}' \
  bun tools/Judge.ts --model gpt-5.6-terra,gpt-5.6-luna,gpt-5.6-sol

bun tools/Report.ts
bun tools/BuildReportPage.ts
bun tools/LeakCheck.ts --root docs
for lane in RAW L5 L6 L7; do
  bun tools/LeakCheck.ts --root "results/phase1/$lane"
done
```

`Judge.ts` is resumable. Re-running a configured pass judges rows still lacking a verdict. A whole
`results/` LeakCheck is intentionally not the live-lane gate: it still finds the retired FORK copies
documented under [Defect record](#defect-record).

## What the benchmark measures

The frozen golden set has five tiers:

| Tier | Purpose | Trials |
|---|---|---:|
| T1 | trivial requests; whether the framework gets out of the way | 1 |
| T2 | ordinary coding and analysis | 1 |
| T3 | heavy engineering | 2 |
| T4 | scope/phrasing routing traps | 2 |
| T5 | grounding against a synthetic profile | 2 |

T1–T4 run across all eight models. T5 runs only on Sonnet and Terra, so it must never be pooled
with the eight-model general-task comparison.

`code:algorithm_read` detects a transcript `Read` whose `file_path` contains the configured
Algorithm directory. It is a proxy, not evidence that the Algorithm was opened first, used, or
completed. Format checks likewise search the complete final message using an unanchored regex on
selected prompts; they do not prove first-line placement or whole-version compliance.

## Hook and routing interpretation

Do not conflate a hook payload being shipped, a hook being actively registered, a runtime execution
artifact, a routing decision, and an Algorithm-directory read. The generated report’s hook evidence
table keeps those facts separate.

- **L6:** hook scripts were present, registered, and executed. `TheRouter` uses fast paths/cache
  before classifier inference. Its nested classifier failed sandbox authentication and, on these
  short heavy prompts, its explicit fail-safe selected `NATIVE`; that is routed fail-safe behavior.
- **L7:** six prompt-submit hooks were registered and executed, but none classified prompts or
  forced Algorithm entry. `AlgorithmNudge` is advisory; `PromptProcessing` performs separate
  inference for naming/title behavior.

The L5/L7 wording difference is a hypothesis worth a controlled ablation, not an established causal
explanation for their observed Algorithm-read difference.

## Isolation model

The final harness uses a cloned staged HOME per cell and a sandbox profile denying the operator’s
real home. The retained RAW artifacts predate that final per-cell HOME arrangement; later LifeOS
cells use it and record selected HOME/state writes. `LeakCheck` invalidates detected escapes.
Captured files are evidence consistent with hook activity, not invocation counts or proof every
hook succeeded. RAW runtime capture is unavailable, not zero.

No credential-bearing material belongs in a sandbox. As a result, a hook that launches a nested
model client can fail authentication by design; that behavior must be reported as a mechanism
limitation rather than casually scored as routing quality.

## Repository layout

```text
goldenset/  frozen prompts, expectations, and judge rubrics
fixtures/   prompt workspaces and synthetic persona
results/    recorded artifacts and secondary generated report
tools/      staging, run, grading, aggregation, reporting, containment
docs/       generated reports, report data, authored narrative, defect record
vendor/     local upstream checkouts (ignored)
sandboxes/  staged installs (ignored)
```

## Defect record

The machine-readable [19-defect record](docs/defects.json) is rendered in the generated report.
Fixes use targeted regression tests where practical and fail-loud assertions or explicit publication
caveats otherwise. Each live lane passes `LeakCheck`; a whole `results/` scan still finds the 101
known violations in retired FORK copies, so that whole-tree result is not represented as clean.
There is intentionally no duplicated hand-written defect table here.
