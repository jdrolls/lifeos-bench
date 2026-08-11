import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { laneMetrics, lanesFor, loadInputs, percent } from "./Aggregate.ts";
import { ensure, path } from "./Common.ts";

async function main() {
  const { config, golden, rows, resultsRoot } = await loadInputs();
  const lines = [
    "# Benchmark Report", "",
    `Golden set ${golden.version} · matrix: ${config.versions.map((version) => version.id).join(" / ")}`, "",
    "## Version × model", "",
    "| Version | Model | Algorithm entered | Algorithm skipped | Mode markers | Format | Task pass@k | Task pass^k | Mean tokens | Mean wall-clock |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  const metricsFor = (version: string, model: string, tier?: string) =>
    laneMetrics({ rows, golden, config, version, model, tier, resultsRoot });

  for (const version of config.versions) {
    for (const model of lanesFor(config, version)) {
      const metric = await metricsFor(version.id, model.id);
      lines.push(`| ${version.id} | ${model.id} | ${percent(metric.algorithmEntryPass, metric.algorithmEntryTotal)} | ` +
        `${percent(metric.algorithmSkipPass, metric.algorithmSkipTotal)} | ${percent(metric.routingPass, metric.routingTotal)} | ` +
        `${percent(metric.formatPass, metric.formatTotal)} | ${percent(metric.anyPass, metric.taskPrompts)} | ` +
        `${percent(metric.allPass, metric.taskPrompts)} | ${metric.cells ? (metric.outputTokens / metric.cells).toFixed(1) : "—"} | ` +
        `${metric.cells ? `${(metric.wallClockMs / metric.cells / 1000).toFixed(2)}s` : "—"} |`);
    }
  }

  lines.push("", "## Per-tier breakdown", "",
    "| Version | Model | Tier | Algorithm entered | Algorithm skipped | Mode markers | Format | Task pass@k | Task pass^k |", "|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const version of config.versions) {
    for (const model of lanesFor(config, version)) {
      for (const tier of Object.keys(config.trials)) {
        const metric = await metricsFor(version.id, model.id, tier);
        lines.push(`| ${version.id} | ${model.id} | ${tier} | ${percent(metric.algorithmEntryPass, metric.algorithmEntryTotal)} | ` +
          `${percent(metric.algorithmSkipPass, metric.algorithmSkipTotal)} | ${percent(metric.routingPass, metric.routingTotal)} | ` +
          `${percent(metric.formatPass, metric.formatTotal)} | ${percent(metric.anyPass, metric.taskPrompts)} | ` +
          `${percent(metric.allPass, metric.taskPrompts)} |`);
      }
    }
  }

  // Emitted with every report, not just kept in the docs: the routing column for the
  // hook-routed versions is not a measurement of those scaffolds, and a reader who sees only
  // this file must not read it as one.
  lines.push("", "## Known limitations — read before quoting any number", "",
    "**Hook-based routing is not measurable by this method, and L7 has no router to measure.**",
    "Only v6 registers a classifier hook (`TheRouter.hook.ts`); v7.28.3 retired modes and ships",
    "no router at all, so an L7 routing figure was never a measurement of routing. v6's router",
    "spawns a nested `claude`; Claude Code passes no auth variable to hook subprocesses and the",
    "sandbox HOME holds no credentials by design, so the router reaches its classifier and then",
    "fails authentication. That is a deliberate isolation invariant, not a bug to fix — so L6",
    "`algorithm_read` measures *unrouted* model behavior and must NOT be read as a scaffold",
    "regression. L5 is unaffected: v5 routes via prose in CLAUDE.md, which spawns nothing.",
    "",
    "**Single/double-trial cells are noisy.** Format compliance has been observed varying run to",
    "run on an identical lane; headline claims need 5-trial confirmation.",
    "",
    "**The judge bar is permissive** (`min_score` 3 of 5, most scores 5), so task pass-rate has",
    "weak power to separate versions.",
    "",
    "**Mean wall-clock is not comparable** across runs at concurrency > 1; cells contend for CPU.",
    "Token counts, routing, format and pass-rates are unaffected.",
    "",
    "**Algorithm entry and Algorithm skip are separate columns.** `code:algorithm_read` asks",
    "opposite questions on opposite prompts — enter the Algorithm for heavy work, do not enter",
    "it for trivial work. Every version passes the skip checks, so a combined column dilutes the",
    "entry rate toward a passing-looking number and hides the largest effect in this dataset.",
    "",
    "**A `skipped` grader is not a failure.** The control cannot know the synthetic persona, so",
    "the golden set skips its T5 grounding checks; those rows are excluded from pass@k rather",
    "than counted against the lane.");

  const pending = rows.filter((row) => row.status === "pending_judge");
  lines.push("", "## Cells needing judge", "");
  if (!pending.length) lines.push("None.");
  else for (const row of pending) lines.push(`- ${row.version}/${row.model}/${row.prompt_id}/trial-${row.trial}: ${row.grader}`);

  const output = path("results", "phase1", "REPORT.md");
  await ensure(join(output, ".."));
  await writeFile(output, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ report: output, grade_rows: rows.length, pending_judges: pending.length }));
}

if (import.meta.main) await main();
