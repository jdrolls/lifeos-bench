import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensure, exists, json, path } from "./Common.ts";

type Row = { version: string; model: string; prompt_id: string; trial: number; grader: string; status: string; detail?: string; reasoning?: string };
const percent = (numerator: number, denominator: number) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : "—";
async function main() {
  const config = await json<any>(path("bench.config.json")); const golden = await json<any>(path("goldenset/goldenset.json")); const gradeFile = path("results", "phase1", "grades.jsonl"); const judgeFile = path("results", "phase1", "judge-grades.jsonl");
  const raw = await exists(gradeFile) ? await readFile(gradeFile, "utf8") : ""; const judgeRaw = await exists(judgeFile) ? await readFile(judgeFile, "utf8") : ""; const latest = new Map<string, Row>(); for (const line of `${raw}\n${judgeRaw}`.split("\n")) { if (!line.trim()) continue; try { const row = JSON.parse(line) as Row; latest.set([row.version,row.model,row.prompt_id,row.trial,row.grader].join("|"), row); } catch { /* report valid rows only */ } }
  const rows = [...latest.values()]; const lines = ["# Benchmark Report", "", `Golden set ${golden.version} · matrix: ${config.versions.map((v: any) => v.id).join(" / ")}`, "", "## Version × model", "", "| Version | Model | Routing-correct | Format | Task pass@k | Task pass^k | Mean tokens | Mean wall-clock |", "|---|---|---:|---:|---:|---:|---:|---:|"];
  // Routing graders are identified by TYPE in the golden set (grader === "code:routing"),
  // not by name prefix — T4 trap graders have descriptive names and must count as routing.
  // Routing is now behavioural (code:algorithm_read) plus, where a version still has modes,
  // the banner check. Format compliance is tracked in its OWN column: a version can follow
  // its output contract perfectly while having no modes at all, and averaging those two
  // together is the mistake that produced the retracted v7 headline.
  const routingNames = new Set<string>();
  const formatNames = new Set<string>();
  for (const prompt of golden.prompts) for (const e of prompt.expectations) {
    if (e.grader === "code:routing" || e.grader === "code:algorithm_read") routingNames.add(`${prompt.id}|${e.name ?? e.grader}`);
    if (e.grader === "code:format_compliance") formatNames.add(`${prompt.id}|${e.name ?? e.grader}`);
  }
  const isRouting = (promptId: string, grader: string) => routingNames.has(`${promptId}|${grader}`);
  const isFormat = (promptId: string, grader: string) => formatNames.has(`${promptId}|${grader}`);
  const metrics = async (version: string, model: string, tier?: string) => {
    const prompts = golden.prompts.filter((prompt: any) => !tier || prompt.tier === tier); let routingPass = 0, routingTotal = 0, formatPass = 0, formatTotal = 0, anyPass = 0, allPass = 0, tokenSum = 0, wallSum = 0, metaCount = 0;
    for (const prompt of prompts) { const trialCount = config.trials[prompt.tier]; const passes: boolean[] = [];
      for (let trial = 1; trial <= trialCount; trial++) { const trialRows = rows.filter(row => row.version === version && row.model === model && row.prompt_id === prompt.id && row.trial === trial);
        for (const row of trialRows.filter(row => isRouting(prompt.id, row.grader))) { if (row.status === "skipped") continue; routingTotal++; if (row.status === "pass") routingPass++; }
        for (const row of trialRows.filter(row => isFormat(prompt.id, row.grader))) { if (row.status === "skipped") continue; formatTotal++; if (row.status === "pass") formatPass++; }
        const task = trialRows.filter(row => !isRouting(prompt.id, row.grader) && !isFormat(prompt.id, row.grader) && row.status !== "pending_judge"); if (task.length) passes.push(task.every(row => row.status === "pass"));
        const metaFile = path("results", "phase1", version, model, prompt.id, `trial-${trial}`, "meta.json"); if (await exists(metaFile)) { try { const meta = await json<any>(metaFile); tokenSum += Number(meta.token_usage?.output_tokens ?? meta.token_usage?.output ?? 0); wallSum += Number(meta.wall_clock_ms ?? 0); metaCount++; } catch { /* absent from mean */ } }
      }
      if (passes.length) { if (passes.some(Boolean)) anyPass++; if (passes.length === trialCount && passes.every(Boolean)) allPass++; }
    }
    const taskPrompts = prompts.filter((prompt: any) => prompt.expectations.some((e: any) => !["code:routing", "code:algorithm_read", "code:format_compliance"].includes(e.grader))).length;
    return { routing: percent(routingPass, routingTotal), format: percent(formatPass, formatTotal), atK: percent(anyPass, taskPrompts), allK: percent(allPass, taskPrompts), tokens: metaCount ? (tokenSum / metaCount).toFixed(1) : "—", wall: metaCount ? `${(wallSum / metaCount / 1000).toFixed(2)}s` : "—" };
  };
  // Only enumerate lanes the matrix actually runs — a version restricted to two models should
  // not render six rows of em-dashes that read as missing data.
  const lanes = (version: any) => config.models.filter((model: any) => !version.models_allowlist || version.models_allowlist.includes(model.id));
  for (const version of config.versions) for (const model of lanes(version)) { const metric = await metrics(version.id, model.id); lines.push(`| ${version.id} | ${model.id} | ${metric.routing} | ${metric.format} | ${metric.atK} | ${metric.allK} | ${metric.tokens} | ${metric.wall} |`); }
  lines.push("", "## Per-tier breakdown", "", "| Version | Model | Tier | Routing-correct | Format | Task pass@k | Task pass^k |", "|---|---|---|---:|---:|---:|---:|");
  for (const version of config.versions) for (const model of lanes(version)) for (const tier of Object.keys(config.trials)) { const metric = await metrics(version.id, model.id, tier); lines.push(`| ${version.id} | ${model.id} | ${tier} | ${metric.routing} | ${metric.format} | ${metric.atK} | ${metric.allK} |`); }
  // Emitted with every report, not just kept in the docs: the routing column for the
  // hook-routed versions is not a measurement of those scaffolds, and a reader who sees only
  // this file must not read it as one.
  lines.push("", "## Known limitations — read before quoting any number", "",
    "**Routing is not measurable for L6/L7 here.** Both route through an LLM-backed classifier",
    "hook. Claude Code spawns hook subprocesses with an EMPTY environment (measured from inside",
    "the hook: `HOME=null, PATH=\"\"`), so the classifier's `spawn('claude')` fails with",
    "\"Executable not found in $PATH\" and the router fail-safes to NATIVE on every prompt. The",
    "classifier is correct when run standalone. So `algorithm_read` for L6/L7 measures *unrouted*",
    "model behavior, not routing design — it is NOT a scaffold regression. L5 is unaffected: v5",
    "routes via prose in CLAUDE.md, which spawns nothing. The same caveat applies to any L7",
    "routing figure in the model sweep.",
    "",
    "**Single/double-trial cells are noisy.** Format compliance has been observed varying run to",
    "run on an identical lane; headline claims need 5-trial confirmation.",
    "",
    "**The judge bar is permissive** (`min_score` 3 of 5, most scores 5), so task pass-rate has",
    "weak power to separate versions.",
    "",
    "**Mean wall-clock is not comparable** across runs at concurrency > 1; cells contend for CPU.",
    "Token counts, routing, format and pass-rates are unaffected.");
  const pending = rows.filter(row => row.status === "pending_judge"); lines.push("", "## Cells needing judge", ""); if (!pending.length) lines.push("None."); else { for (const row of pending) lines.push(`- ${row.version}/${row.model}/${row.prompt_id}/trial-${row.trial}: ${row.grader}`); }
  const output = path("results", "phase1", "REPORT.md"); await ensure(join(output, "..")); await writeFile(output, lines.join("\n") + "\n"); console.log(JSON.stringify({ report: output, grade_rows: rows.length, pending_judges: pending.length }));
}
if (import.meta.main) await main();
