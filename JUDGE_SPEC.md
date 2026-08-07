# Slice C — tools/Judge.ts (cross-vendor rubric judging)

Read SPEC.md for repo context; `goldenset/rubrics.json` defines rubrics + judging protocol.
Do NOT touch tools other than adding `tools/Judge.ts` (+ its tests), and do not modify frozen
goldenset files.

## Contract

`bun tools/Judge.ts [--limit N] [--dry-run]`:

1. Read `results/phase1/grades.jsonl`; select rows with `status: "pending_judge"` that don't
   already have a corresponding row in `results/phase1/judge-grades.jsonl`.
2. For each: load the rubric from rubrics.json, the trial's meta.json (`final_message`) and
   `workspace-diff.txt` (only if the rubric's `inputs` include it).
3. **Blinding scrub** before the judge sees anything: strip lines matching mode banners /
   framework markers (`♻`, `═══`, `PAI`, `ALGORITHM`, `NATIVE MODE`, `MINIMAL`, `🗣️`,
   `LifeOS`, `LIFEOS`) from the response text. The judge must not be able to identify which
   scaffolding produced the output.
4. Build a judge prompt: rubric criteria + score anchors + the scrubbed materials. Demand
   STRICT JSON reply: `{"score": 1-5, "reasoning": "...", "criteria_met": ["..."]}`.
5. Invoke the judge via the `JUDGE_CMD` env var — a shell template containing `{promptfile}`,
   e.g. `JUDGE_CMD='mytool --prompt-file {promptfile}'`. Judge.ts writes the prompt to a temp
   file, substitutes, runs with stdin closed and a 120s timeout, parses the LAST valid JSON
   object in stdout. Malformed output → one retry, then record `status: "judge_error"`.
6. Append rows to `results/phase1/judge-grades.jsonl`:
   `{version, model, prompt_id, trial, grader, rubric, score, min_score, status: pass|fail|judge_error, reasoning}`.
   Resume-safe: re-runs skip already-judged rows.
7. `--dry-run` prints the pending count and the first scrubbed prompt without invoking anything.

Also update `tools/Report.ts` minimally: merge judge-grades.jsonl rows into the report's
pass-rate math when the file exists (leave "cells needing judge" listing for still-pending rows).

## Acceptance (run + paste output)
1. Unit tests for the blinding scrub (banner lines removed, content preserved) and JSON
   extraction (valid, trailing-noise, malformed → retry path) — add to tests/.
2. `bun test` green at root.
3. `JUDGE_CMD='cat {promptfile} > /dev/null && echo {"score":4,"reasoning":"stub","criteria_met":[]}' bun tools/Judge.ts --dry-run` behaves sanely with zero pending rows (prints 0, exits 0).
