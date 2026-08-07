import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensure, exists, json, path } from "./Common.ts";

type Row = { version: string; model: string; prompt_id: string; trial: number; grader: string; status: string; detail?: string; reasoning?: string };
const percent = (numerator: number, denominator: number) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : "—";
async function main() {
  const config = await json<any>(path("bench.config.json")); const golden = await json<any>(path("goldenset/goldenset.json")); const gradeFile = path("results", "phase1", "grades.jsonl"); const judgeFile = path("results", "phase1", "judge-grades.jsonl");
  const raw = await exists(gradeFile) ? await readFile(gradeFile, "utf8") : ""; const judgeRaw = await exists(judgeFile) ? await readFile(judgeFile, "utf8") : ""; const latest = new Map<string, Row>(); for (const line of `${raw}\n${judgeRaw}`.split("\n")) { if (!line.trim()) continue; try { const row = JSON.parse(line) as Row; latest.set([row.version,row.model,row.prompt_id,row.trial,row.grader].join("|"), row); } catch { /* report valid rows only */ } }
  const rows = [...latest.values()]; const lines = ["# Phase 1 Report", "", "## Version × model", "", "| Version | Model | Routing-correct | Task pass@k | Task pass^k | Mean tokens | Mean wall-clock |", "|---|---:|---:|---:|---:|---:|---:|"];
  const metrics = async (version: string, model: string, tier?: string) => {
    const prompts = golden.prompts.filter((prompt: any) => !tier || prompt.tier === tier); let routingPass = 0, routingTotal = 0, anyPass = 0, allPass = 0, tokenSum = 0, wallSum = 0, metaCount = 0;
    for (const prompt of prompts) { const trialCount = config.trials[prompt.tier]; const passes: boolean[] = [];
      for (let trial = 1; trial <= trialCount; trial++) { const trialRows = rows.filter(row => row.version === version && row.model === model && row.prompt_id === prompt.id && row.trial === trial); const routing = trialRows.find(row => row.grader.startsWith("routed_") || row.grader === "code:routing"); if (routing && routing.status !== "skipped") { routingTotal++; if (routing.status === "pass") routingPass++; }
        const task = trialRows.filter(row => !(row.grader.startsWith("routed_") || row.grader === "code:routing") && row.status !== "pending_judge"); if (task.length) passes.push(task.every(row => row.status === "pass"));
        const metaFile = path("results", "phase1", version, model, prompt.id, `trial-${trial}`, "meta.json"); if (await exists(metaFile)) { try { const meta = await json<any>(metaFile); tokenSum += Number(meta.token_usage?.output_tokens ?? meta.token_usage?.output ?? 0); wallSum += Number(meta.wall_clock_ms ?? 0); metaCount++; } catch { /* absent from mean */ } }
      }
      if (passes.length) { if (passes.some(Boolean)) anyPass++; if (passes.length === trialCount && passes.every(Boolean)) allPass++; }
    }
    const taskPrompts = prompts.filter((prompt: any) => prompt.expectations.some((e: any) => e.grader !== "code:routing")).length;
    return { routing: percent(routingPass, routingTotal), atK: percent(anyPass, taskPrompts), allK: percent(allPass, taskPrompts), tokens: metaCount ? (tokenSum / metaCount).toFixed(1) : "—", wall: metaCount ? `${(wallSum / metaCount / 1000).toFixed(2)}s` : "—" };
  };
  for (const version of config.versions) for (const model of config.models) { const metric = await metrics(version.id, model.id); lines.push(`| ${version.id} | ${model.id} | ${metric.routing} | ${metric.atK} | ${metric.allK} | ${metric.tokens} | ${metric.wall} |`); }
  lines.push("", "## Per-tier breakdown", "", "| Version | Model | Tier | Routing-correct | Task pass@k | Task pass^k |", "|---|---|---|---:|---:|---:|");
  for (const version of config.versions) for (const model of config.models) for (const tier of Object.keys(config.trials)) { const metric = await metrics(version.id, model.id, tier); lines.push(`| ${version.id} | ${model.id} | ${tier} | ${metric.routing} | ${metric.atK} | ${metric.allK} |`); }
  const pending = rows.filter(row => row.status === "pending_judge"); lines.push("", "## Cells needing judge", ""); if (!pending.length) lines.push("None."); else { for (const row of pending) lines.push(`- ${row.version}/${row.model}/${row.prompt_id}/trial-${row.trial}: ${row.grader}`); }
  const output = path("results", "phase1", "REPORT.md"); await ensure(join(output, "..")); await writeFile(output, lines.join("\n") + "\n"); console.log(JSON.stringify({ report: output, grade_rows: rows.length, pending_judges: pending.length }));
}
if (import.meta.main) await main();
