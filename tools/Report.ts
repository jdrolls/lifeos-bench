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
    "| Version | Model | Algorithm-directory Read observed (heavy) | No Algorithm-directory Read observed (selected trivial) | Mode markers | Configured format marker found on selected checked prompts | Succeeded in at least one trial | Succeeded in every trial | Mean CLI-reported tokens | Mean wall-clock |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  const metricsFor = (version: string, model: string, tier?: string | string[]) =>
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
    "| Version | Model | Tier | Algorithm-directory Read observed (heavy) | No Algorithm-directory Read observed (selected trivial) | Mode markers | Configured format marker found | Succeeded in at least one trial | Succeeded in every trial |", "|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const version of config.versions) {
    for (const model of lanesFor(config, version)) {
      for (const tier of Object.keys(config.trials)) {
        if (config.tier_models?.[tier] && !config.tier_models[tier].includes(model.id)) continue;
        const metric = await metricsFor(version.id, model.id, tier);
        lines.push(`| ${version.id} | ${model.id} | ${tier} | ${percent(metric.algorithmEntryPass, metric.algorithmEntryTotal)} | ` +
          `${percent(metric.algorithmSkipPass, metric.algorithmSkipTotal)} | ${percent(metric.routingPass, metric.routingTotal)} | ` +
          `${percent(metric.formatPass, metric.formatTotal)} | ${percent(metric.anyPass, metric.taskPrompts)} | ` +
          `${percent(metric.allPass, metric.taskPrompts)} |`);
      }
    }
  }

  const pending = rows.filter((row) => row.status === "pending_judge");
  lines.push("", "## Scope and caveats", "",
    "- `code:algorithm_read` detects any transcript `Read` whose `file_path` contains the configured Algorithm directory. It does not prove ordering, an ISA/run, or that the Algorithm was followed.",
    "- L6 hook scripts were present, registered, and executed. Its nested classifier failed authentication; for the benchmark's short heavy prompts its explicit fail-safe selected `NATIVE`, which is routed fail-safe behavior.",
    "- L7 registered and executed six prompt-submit hooks, but none classified or forced Algorithm entry. `AlgorithmNudge` is advisory; `PromptProcessing` performs separate inference for naming/title behavior.",
    "- Algorithm-skip is separate because it asks the opposite question, not because it universally passes; L5 Terra is the documented 2/4 exception.",
    "- Format is an unanchored full-message regex on selected prompts, not proof of first-line or whole-version compliance.",
    "- Single/double-trial cells are noisy. The judge floor is 3/5, marker scrubbing is not guaranteed complete blinding, recorded judge rows lack provider/model provenance, and the frozen rubric's score-three alternate-vendor rejudge was not implemented.",
    "- This cold-start, single-turn benchmark does not test memory, continuity, multi-turn collaboration, accumulated context, or long-term outcomes.",
    "",
    "## Cells needing judge", "");
  if (!pending.length) lines.push("None.");
  else for (const row of pending) lines.push(`- ${row.version}/${row.model}/${row.prompt_id}/trial-${row.trial}: ${row.grader}`);

  const output = path("results", "phase1", "REPORT.md");
  await ensure(join(output, ".."));
  await writeFile(output, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ report: output, grade_rows: rows.length, pending_judges: pending.length }));
}

if (import.meta.main) await main();
