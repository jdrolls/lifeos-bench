import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  laneMetrics,
  lanesFor,
  latestRows,
  loadInputs,
  ratio,
  type BenchConfig,
  type GoldenSet,
  type LaneMetrics,
  type Row,
} from "./Aggregate.ts";
import { ensure, exists, path } from "./Common.ts";

// Reader-facing order: answers and caveats first, method details after the findings.
const SECTION_IDS = ["summary", "general", "personalization", "algorithm", "cost", "limits", "method", "audit", "appendix"] as const;
type SectionId = typeof SECTION_IDS[number];

export type ReportSection = { id: string; title: string; bodyMarkdown: string; bodyHtml: string };
type Numeric = number | null;
type DisplayMetrics = {
  algorithm_entry_pct: Numeric; algorithm_entry_pass: number; algorithm_entry_total: number;
  algorithm_skip_pct: Numeric; algorithm_skip_pass: number; algorithm_skip_total: number;
  mode_marker_pct: Numeric;
  format_pct: Numeric; format_pass: number; format_total: number;
  task_at_k_pct: Numeric; task_all_k_pct: Numeric;
  task_prompts: number; any_pass: number; all_pass: number;
  cells: number; statuses: Record<string, number>;
  output_tokens_mean: Numeric; wall_clock_mean_s: Numeric; cost_usd_total: number;
  hook_files_mean: Numeric;
};
export type LaneRecord = DisplayMetrics & { version: string; model: string };
export type TierRecord = LaneRecord & { tier: string };
type VersionRecord = {
  version: string; cells: number; output_tokens_mean: Numeric; cost_usd_total: number;
  wall_clock_mean_s: Numeric; hook_files_mean: Numeric; statuses: Record<string, number>;
  task_at_k_pct: Numeric; format_pct: Numeric; algorithm_entry_pct: Numeric;
};
export type ReportData = {
  generated: { golden_set: string; grade_rows: number; versions: string[]; models: string[]; trials: Record<string, number>; tier_models: Record<string, string[]>;
    prompts: Array<{ id: string; tier: string; prompt: string; checks: string[] }> };
  lanes: LaneRecord[]; tiers: TierRecord[]; versions: VersionRecord[];
  /** RAW/L7 use the same 16 T1–T4 prompt outcomes for every model. */
  raw_vs_l7: Array<{ model: string; prompt_model_cases: number; raw_pass: number; l7_pass: number; delta_pass: number; raw_at_k: Numeric; l7_at_k: Numeric; delta_at_k_pp: number; delta_at_k: Numeric; raw_all_pass: number; l7_all_pass: number; delta_all_pass: number; raw_all_k: Numeric; l7_all_k: Numeric; delta_all_k_pp: number; delta_all_k: Numeric }>;
  /** Outcome summaries only combine lanes that share the named model and tier scope. */
  outcome_summaries: Array<{ version: string; scope: "all eight models" | "matched two-model pool" | "T5 configured pool"; tiers: string; prompt_model_cases: number; at_k_pass: number; all_k_pass: number; at_k: Numeric; all_k: Numeric }>;
  /** The 68 cells shared by every version: configured T5 model pool, all five tiers. */
  matched_versions: VersionRecord[];
  algorithm_families: Array<{ version: string; family: "Claude" | "GPT"; pass: number; total: number; pct: Numeric }>;
  hook_evidence: Array<{ version: string; hook_payload: string; active_registration: string; runtime_execution: string; routing_responsibility: string; algorithm_directory_read: string }>;
  judge: { rows: number; pass: number; fail: number; errors: number; score_histogram: Record<string, number>; by_version: Record<string, { rows: number; pass: number; fail: number; errors: number }> };
  run: { cells_total: number; statuses: Record<string, number>; cumulative_cell_hours: number; api_equivalent_cost_usd: number; pending_judge: number };
};

type BarValue = { label: string; value: Numeric };
type GroupedSeries = { label: string; values: Numeric[] };

/** The harness marks its GPT lanes explicitly; names are presentation labels, not classification. */
export function modelFamily(model: BenchConfig["models"][number]): "Claude" | "GPT" {
  return model.engine === "claudex" ? "GPT" : "Claude";
}

/** Sum the current per-lane Algorithm-read metrics rather than duplicating their totals in prose. */
export function algorithmReadTotals(lanes: Array<Pick<LaneRecord, "version" | "algorithm_entry_pass" | "algorithm_entry_total">>, version: string): string {
  const scoped = lanes.filter((lane) => lane.version === version);
  return `${scoped.reduce((total, lane) => total + lane.algorithm_entry_pass, 0)}/${scoped.reduce((total, lane) => total + lane.algorithm_entry_total, 0)}`;
}

/** Round a shared Aggregate.ratio result for presentation without converting it to a string. */
export function roundedPercent(numerator: number, denominator: number): Numeric {
  const value = ratio(numerator, denominator);
  return value === null ? null : Number(value.toFixed(1));
}

function rounded(value: number, digits: number): number { return Number(value.toFixed(digits)); }
function mean(total: number, count: number, digits: number): Numeric { return count === 0 ? null : rounded(total / count, digits); }
function sumStatuses(records: Array<{ statuses: Record<string, number> }>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const record of records) for (const [status, count] of Object.entries(record.statuses)) totals[status] = (totals[status] ?? 0) + count;
  return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)));
}
function metricRecord(metrics: LaneMetrics): DisplayMetrics {
  return {
    algorithm_entry_pct: roundedPercent(metrics.algorithmEntryPass, metrics.algorithmEntryTotal),
    algorithm_entry_pass: metrics.algorithmEntryPass, algorithm_entry_total: metrics.algorithmEntryTotal,
    algorithm_skip_pct: roundedPercent(metrics.algorithmSkipPass, metrics.algorithmSkipTotal),
    algorithm_skip_pass: metrics.algorithmSkipPass, algorithm_skip_total: metrics.algorithmSkipTotal,
    mode_marker_pct: roundedPercent(metrics.routingPass, metrics.routingTotal),
    format_pct: roundedPercent(metrics.formatPass, metrics.formatTotal), format_pass: metrics.formatPass, format_total: metrics.formatTotal,
    task_at_k_pct: roundedPercent(metrics.anyPass, metrics.taskPrompts), task_all_k_pct: roundedPercent(metrics.allPass, metrics.taskPrompts),
    task_prompts: metrics.taskPrompts, any_pass: metrics.anyPass, all_pass: metrics.allPass,
    cells: metrics.cells, statuses: sumStatuses([metrics]),
    output_tokens_mean: mean(metrics.outputTokens, metrics.cells, 1), wall_clock_mean_s: mean(metrics.wallClockMs / 1000, metrics.cells, 2),
    cost_usd_total: rounded(metrics.costUsd, 2), hook_files_mean: mean(metrics.hookFilesWritten, metrics.hookCells, 1),
  };
}

function rollupVersion(version: string, lanes: LaneRecord[], source: LaneMetrics[]): VersionRecord {
  const cells = source.reduce((total, metric) => total + metric.cells, 0);
  const tokenTotal = source.reduce((total, metric) => total + metric.outputTokens, 0);
  const wallTotal = source.reduce((total, metric) => total + metric.wallClockMs, 0);
  const costTotal = source.reduce((total, metric) => total + metric.costUsd, 0);
  const hookTotal = source.reduce((total, metric) => total + metric.hookFilesWritten, 0);
  const hookCells = source.reduce((total, metric) => total + metric.hookCells, 0);
  const entryPass = source.reduce((total, metric) => total + metric.algorithmEntryPass, 0);
  const entryTotal = source.reduce((total, metric) => total + metric.algorithmEntryTotal, 0);
  const formatPass = source.reduce((total, metric) => total + metric.formatPass, 0);
  const formatTotal = source.reduce((total, metric) => total + metric.formatTotal, 0);
  const anyPass = source.reduce((total, metric) => total + metric.anyPass, 0);
  const taskPrompts = source.reduce((total, metric) => total + metric.taskPrompts, 0);
  return {
    version, cells, output_tokens_mean: mean(tokenTotal, cells, 1), cost_usd_total: rounded(costTotal, 2),
    wall_clock_mean_s: mean(wallTotal / 1000, cells, 2), hook_files_mean: mean(hookTotal, hookCells, 1),
    statuses: sumStatuses(lanes), task_at_k_pct: roundedPercent(anyPass, taskPrompts),
    format_pct: roundedPercent(formatPass, formatTotal), algorithm_entry_pct: roundedPercent(entryPass, entryTotal),
  };
}

async function judgeSummary(resultsRoot: string, versionOrder: string[]): Promise<ReportData["judge"]> {
  const judgeFile = join(resultsRoot, "judge-grades.jsonl");
  const source = await exists(judgeFile) ? await Bun.file(judgeFile).text() : "";
  const rows = latestRows(source);
  const score_histogram: Record<string, number> = Object.fromEntries([1, 2, 3, 4, 5].map((score) => [String(score), 0]));
  const byVersion = new Map<string, { rows: number; pass: number; fail: number; errors: number }>();
  let pass = 0; let fail = 0; let errors = 0;
  for (const row of rows) {
    if (row.status === "pass") pass++;
    else if (row.status === "fail") fail++;
    else if (row.status === "judge_error") errors++;
    if (Number.isInteger(row.score) && row.score! >= 1 && row.score! <= 5) score_histogram[String(row.score)]++;
    const summary = byVersion.get(row.version) ?? { rows: 0, pass: 0, fail: 0, errors: 0 };
    summary.rows++;
    if (row.status === "pass") summary.pass++;
    else if (row.status === "fail") summary.fail++;
    else if (row.status === "judge_error") summary.errors++;
    byVersion.set(row.version, summary);
  }
  const ordered = [...byVersion.keys()].sort((a, b) => {
    const ai = versionOrder.indexOf(a); const bi = versionOrder.indexOf(b);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.localeCompare(b);
  });
  return { rows: rows.length, pass, fail, errors, score_histogram, by_version: Object.fromEntries(ordered.map((version) => [version, byVersion.get(version)!])) };
}

/** Build the entire JSON contract using Aggregate's canonical per-lane metric calculation. */
export async function buildReportData(): Promise<ReportData> {
  const { config, golden, rows, resultsRoot } = await loadInputs();
  const lanes: LaneRecord[] = [];
  const laneSources = new Map<string, LaneMetrics>();
  const tiers: TierRecord[] = [];
  const tierNames = Object.keys(config.trials);

  for (const version of config.versions) {
    for (const model of lanesFor(config, version)) {
      const laneSource = await laneMetrics({ rows, golden, config, version: version.id, model: model.id, resultsRoot });
      const lane = { version: version.id, model: model.id, ...metricRecord(laneSource) };
      lanes.push(lane); laneSources.set(`${version.id}\u0000${model.id}`, laneSource);
      for (const tier of tierNames) {
        if (config.tier_models?.[tier] && !config.tier_models[tier].includes(model.id)) continue;
        const tierSource = await laneMetrics({ rows, golden, config, version: version.id, model: model.id, tier, resultsRoot });
        tiers.push({ version: version.id, model: model.id, tier, ...metricRecord(tierSource) });
      }
    }
  }

  const versions = config.versions.map((version) => {
    const versionLanes = lanes.filter((lane) => lane.version === version.id);
    const sources = versionLanes.map((lane) => laneSources.get(`${lane.version}\u0000${lane.model}`)!);
    return rollupVersion(version.id, versionLanes, sources);
  });
  const generalTiers = ["T1", "T2", "T3", "T4"];
  const configuredT5Models = config.tier_models?.T5 ?? config.models.map((model) => model.id);
  const allModels = config.models.map((model) => model.id);
  const raw_vs_l7 = (await Promise.all(config.models.map(async (model) => {
    const [raw, l7] = await Promise.all(["RAW", "L7"].map((version) =>
      laneMetrics({ rows, golden, config, version, model: model.id, tier: generalTiers, resultsRoot })));
    if (!raw.taskPrompts || raw.taskPrompts !== l7.taskPrompts) return null;
    return {
      model: model.id, prompt_model_cases: raw.taskPrompts,
      raw_pass: raw.anyPass, l7_pass: l7.anyPass, delta_pass: l7.anyPass - raw.anyPass,
      raw_at_k: roundedPercent(raw.anyPass, raw.taskPrompts), l7_at_k: roundedPercent(l7.anyPass, l7.taskPrompts),
      delta_at_k_pp: ratio(l7.anyPass - raw.anyPass, raw.taskPrompts)!,
      delta_at_k: roundedPercent(l7.anyPass - raw.anyPass, raw.taskPrompts),
      raw_all_pass: raw.allPass, l7_all_pass: l7.allPass, delta_all_pass: l7.allPass - raw.allPass,
      raw_all_k: roundedPercent(raw.allPass, raw.taskPrompts), l7_all_k: roundedPercent(l7.allPass, l7.taskPrompts),
      delta_all_k_pp: ratio(l7.allPass - raw.allPass, raw.taskPrompts)!,
      delta_all_k: roundedPercent(l7.allPass - raw.allPass, raw.taskPrompts),
    };
  }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const outcomeSpecs: Array<{ scope: ReportData["outcome_summaries"][number]["scope"]; tiers: string[]; models: string[] }> = [
    { scope: "all eight models", tiers: generalTiers, models: allModels },
    { scope: "matched two-model pool", tiers: generalTiers, models: configuredT5Models },
    { scope: "T5 configured pool", tiers: ["T5"], models: configuredT5Models },
  ];
  const outcome_summaries = config.versions.flatMap((version) => outcomeSpecs.flatMap((spec) => {
    const scoped = tiers.filter((tier) => tier.version === version.id && spec.tiers.includes(tier.tier) && spec.models.includes(tier.model));
    // A scope is publishable only when every configured model actually ran it. L5 has no
    // all-eight result; silently treating its two lanes as eight would be a false comparison.
    if (new Set(scoped.map((tier) => tier.model)).size !== spec.models.length) return [];
    const prompt_model_cases = scoped.reduce((total, tier) => total + tier.task_prompts, 0);
    const at_k_pass = scoped.reduce((total, tier) => total + tier.any_pass, 0);
    const all_k_pass = scoped.reduce((total, tier) => total + tier.all_pass, 0);
    return [{ version: version.id, scope: spec.scope, tiers: spec.tiers.join("–"), prompt_model_cases, at_k_pass, all_k_pass,
      at_k: roundedPercent(at_k_pass, prompt_model_cases), all_k: roundedPercent(all_k_pass, prompt_model_cases) }];
  }));

  const matched_versions = config.versions.map((version) => {
    const versionLanes = lanes.filter((lane) => lane.version === version.id && configuredT5Models.includes(lane.model));
    const sources = versionLanes.map((lane) => laneSources.get(`${lane.version}\u0000${lane.model}`)!);
    return rollupVersion(version.id, versionLanes, sources);
  });
  const algorithm_families = config.versions.flatMap((version) =>
    (["Claude", "GPT"] as const).flatMap((family) => {
      const models = config.models.filter((model) => modelFamily(model) === family).map((model) => model.id);
      const sources = models.map((model) => laneSources.get(`${version.id}\u0000${model}`)).filter((source): source is LaneMetrics => !!source);
      const pass = sources.reduce((total, source) => total + source.algorithmEntryPass, 0);
      const total = sources.reduce((count, source) => count + source.algorithmEntryTotal, 0);
      return total ? [{ version: version.id, family, pass, total, pct: roundedPercent(pass, total) }] : [];
    }));

  const hook_evidence: ReportData["hook_evidence"] = [
    { version: "RAW", hook_payload: "No LifeOS payload", active_registration: "No LifeOS registration", runtime_execution: "Unavailable", routing_responsibility: "None", algorithm_directory_read: "Not applicable" },
    { version: "L5", hook_payload: "Present", active_registration: "Present", runtime_execution: "Captured state files", routing_responsibility: "Prose instruction, not a routing hook", algorithm_directory_read: algorithmReadTotals(lanes, "L5") },
    { version: "L6", hook_payload: "Present", active_registration: "Present", runtime_execution: "Observed", routing_responsibility: "TheRouter classifier", algorithm_directory_read: algorithmReadTotals(lanes, "L6") },
    { version: "L7", hook_payload: "Present", active_registration: "Six prompt-submit hooks", runtime_execution: "Observed", routing_responsibility: "None; AlgorithmNudge is advisory", algorithm_directory_read: algorithmReadTotals(lanes, "L7") },
  ];

  const allSources = [...laneSources.values()];
  const allCells = allSources.reduce((total, metric) => total + metric.cells, 0);
  const allWall = allSources.reduce((total, metric) => total + metric.wallClockMs, 0);
  const allCost = allSources.reduce((total, metric) => total + metric.costUsd, 0);
  return {
    generated: {
      golden_set: golden.version, grade_rows: rows.length,
      versions: config.versions.map((version) => version.id), models: config.models.map((model) => model.id),
      trials: config.trials, tier_models: config.tier_models ?? {},
      // The prompts themselves are part of the method, not an appendix curiosity: a reader
      // cannot judge whether a tier measures what it claims without seeing what was asked.
      prompts: golden.prompts.map((prompt) => ({
        id: prompt.id, tier: prompt.tier, prompt: prompt.prompt ?? "",
        checks: prompt.expectations.map((expectation) => expectation.name ?? expectation.grader),
      })),
    },
    lanes, tiers, versions, raw_vs_l7, outcome_summaries, matched_versions, algorithm_families, hook_evidence,
    judge: await judgeSummary(resultsRoot, config.versions.map((version) => version.id)),
    run: { cells_total: allCells, statuses: sumStatuses(lanes), cumulative_cell_hours: rounded(allWall / 3_600_000, 2), api_equivalent_cost_usd: rounded(allCost, 2), pending_judge: rows.filter((row) => row.status === "pending_judge").length },
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Safe inline subset: escape first, then introduce only the tags this renderer owns. */
function safeHref(escapedUrl: string): string {
  return /^(?:https?:|mailto:|\/(?!\/)|\.{1,2}\/|#)/i.test(escapedUrl) ? escapedUrl : "#";
}

export function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  const code: string[] = [];
  const protectedCode = escaped.replace(/`([^`]+)`/g, (_, value: string) => `\u0000CODE${code.push(`<code>${value}</code>`) - 1}\u0000`);
  const linked = protectedCode.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label: string, url: string) => `<a href="${safeHref(url)}" rel="noopener noreferrer">${label}</a>`);
  const formatted = linked.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return formatted.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => code[Number(index)]!);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}
function tableCells(line: string): string[] { return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()); }

/** Render the intentionally small prose subset used by report-sections.md. */
export function renderMarkdownSubset(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    if (/^\|/.test(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1]!)) {
      const header = tableCells(line); index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|/.test(lines[index]!)) rows.push(tableCells(lines[index++]!));
      output.push(`<div class="table-wrap prose"><table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, cell) => `<td>${renderInline(row[cell] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^###\s+/.test(line)) { output.push(`<h3>${renderInline(line.replace(/^###\s+/, ""))}</h3>`); index++; continue; }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^>\s?/, ""));
      output.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`); continue;
    }
    const unordered = /^-\s+/.test(line); const ordered = /^\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const pattern = unordered ? /^-\s+/ : /^\d+\.\s+/; const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index]!)) {
        const item = [lines[index++]!.replace(pattern, "")];
        // Wrapped list items are the normal way prose is written; without this an item that
        // spans two source lines rendered as a bullet followed by an orphaned paragraph.
        while (index < lines.length && /^\s+\S/.test(lines[index]!) && !pattern.test(lines[index]!.trim())) {
          item.push(lines[index++]!.trim());
        }
        items.push(item.join(" "));
      }
      const tag = unordered ? "ul" : "ol";
      output.push(`<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`); continue;
    }
    const paragraph: string[] = [line]; index++;
    while (index < lines.length && lines[index]!.trim() && !/^###\s+|^>\s?|^-\s+|^\d+\.\s+|^\|/.test(lines[index]!)) paragraph.push(lines[index++]!);
    output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}

export function parseSections(markdown: string): ReportSection[] {
  const marker = /^<!--section:\s*id=([^\s]+)\s+title=(.*?)-->\s*$/gm;
  const matches = [...markdown.matchAll(marker)];
  return matches.map((match, index) => {
    const bodyMarkdown = markdown.slice(match.index! + match[0].length, matches[index + 1]?.index ?? markdown.length).trim();
    return { id: match[1]!, title: match[2]!.trim(), bodyMarkdown, bodyHtml: renderMarkdownSubset(bodyMarkdown) };
  });
}

export function placeholderSectionsMarkdown(): string {
  return SECTION_IDS.map((id) => `<!--section: id=${id} title=${id[0]!.toUpperCase()}${id.slice(1)}-->\nTODO`).join("\n\n") + "\n";
}

/** Load author-owned prose, creating a minimal editable template only on first build. */
export async function loadSections(file = path("docs", "report-sections.md")): Promise<ReportSection[]> {
  if (!(await exists(file))) {
    await ensure(join(file, ".."));
    await writeFile(file, placeholderSectionsMarkdown(), "utf8");
  }
  return parseSections(await readFile(file, "utf8"));
}

function svgText(value: string): string { return escapeHtml(value); }
function svgRoot(title: string, body: string, width: number, height: number): string {
  return `<svg role="img" aria-label="${svgText(title)}" viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><title>${svgText(title)}</title>${body}</svg>`;
}
function ticks(maximum: number, count = 4): number[] { return Array.from({ length: count + 1 }, (_, index) => maximum * index / count); }

/**
 * Round an axis up so its four gridlines land on readable numbers.
 *
 * `Math.ceil(max / 5) * 5` was enough for percentages and produced axes like
 * 0 / 2727.5 / 5455 / 8182.5 / 10910 for token counts — technically correct, unreadable.
 */
export function niceMax(maximum: number, divisions = 4): number {
  if (!(maximum > 0)) return 1;
  const rough = maximum / divisions;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 3, 4, 5, 10].find((candidate) => candidate * magnitude >= rough)! * magnitude;
  return step * divisions;
}
function tickLabel(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

export function simpleBarChart(title: string, values: BarValue[], unit = ""): string {
  const width = Math.max(480, values.length * 92 + 74); const height = 310; const left = 54; const right = 18; const top = 36; const bottom = 80;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const max = Math.max(1, ...values.map((entry) => entry.value ?? 0));
  const axisMax = niceMax(max);
  let body = `<g class="chart-grid">`;
  for (const tick of ticks(axisMax)) { const y = top + plotHeight - (tick / axisMax) * plotHeight; body += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 7}" y="${y + 4}" text-anchor="end">${tickLabel(tick)}</text>`; }
  body += `</g><line class="chart-axis" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}"/>`;
  const slot = plotWidth / Math.max(values.length, 1); const barWidth = Math.min(48, slot * 0.62);
  values.forEach((entry, index) => {
    const value = entry.value; const x = left + index * slot + (slot - barWidth) / 2;
    if (value !== null) { const barHeight = value / axisMax * plotHeight; const y = top + plotHeight - barHeight; body += `<rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--series-1)"/><text class="chart-value" x="${x + barWidth / 2}" y="${Math.max(top + 12, y - 5)}" text-anchor="middle">${tickLabel(value)}${unit}</text>`; }
    else body += `<text class="chart-value" x="${x + barWidth / 2}" y="${top + plotHeight - 5}" text-anchor="middle">—</text>`;
    body += `<text x="${x + barWidth / 2}" y="${height - 49}" text-anchor="middle" class="chart-label">${svgText(entry.label)}</text>`;
  });
  return svgRoot(title, body, width, height);
}

export function groupedBarChart(title: string, labels: string[], series: GroupedSeries[], unit = "%"): string {
  const width = Math.max(560, labels.length * 112 + 82); const height = 350; const left = 54; const right = 18; const top = 60; const bottom = 80;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom; const max = Math.max(1, ...series.flatMap((item) => item.values.map((value) => value ?? 0)));
  const axisMax = max <= 100 && unit === "%" ? 100 : niceMax(max);
  let body = `<g class="chart-grid">`;
  for (const tick of ticks(axisMax)) { const y = top + plotHeight - tick / axisMax * plotHeight; body += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text x="${left - 7}" y="${y + 4}" text-anchor="end">${tickLabel(tick)}</text>`; }
  body += `</g><line class="chart-axis" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}"/>`;
  series.forEach((item, index) => { const x = left + index * 100; body += `<circle cx="${x}" cy="22" r="5" fill="var(--series-${index % 4 + 1})"/><text x="${x + 9}" y="26" class="chart-legend">${svgText(item.label)}</text>`; });
  const groupWidth = plotWidth / Math.max(labels.length, 1); const barWidth = Math.min(24, groupWidth * 0.75 / Math.max(series.length, 1));
  // Four series per group puts the value labels closer together than the text is wide, and they
  // overprint into an unreadable smear. Compare the widest label against the space a bar actually
  // has (~5.6px per character at the 10px chart-value size); below that the axis carries the
  // reading, every bar keeps a hover title, and the appendix table carries the exact figure.
  const widestLabel = Math.max(...series.flatMap((item) => item.values.map((value) =>
    value === null ? 0 : `${tickLabel(value)}${unit}`.length)), 0);
  const showValues = barWidth >= widestLabel * 5.6;
  labels.forEach((label, labelIndex) => {
    const groupStart = left + labelIndex * groupWidth + (groupWidth - barWidth * series.length) / 2;
    series.forEach((item, seriesIndex) => {
      const value = item.values[labelIndex] ?? null; const x = groupStart + seriesIndex * barWidth;
      if (value !== null) {
        const barHeight = value / axisMax * plotHeight; const y = top + plotHeight - barHeight;
        body += `<rect class="bar" x="${x}" y="${y}" width="${Math.max(2, barWidth - 2)}" height="${barHeight}" fill="var(--series-${seriesIndex % 4 + 1})"><title>${svgText(`${item.label} · ${label}: ${tickLabel(value)}${unit}`)}</title></rect>`;
        if (showValues) body += `<text class="chart-value" x="${x + barWidth / 2}" y="${Math.max(top + 12, y - 4)}" text-anchor="middle">${tickLabel(value)}${unit}</text>`;
      }
    });
    body += `<text x="${left + labelIndex * groupWidth + groupWidth / 2}" y="${height - 49}" text-anchor="middle" class="chart-label">${svgText(label)}</text>`;
  });
  return svgRoot(title, body, width, height);
}

export function divergingBarChart(title: string, values: BarValue[], unit = "pp"): string {
  const width = 640; const height = Math.max(190, values.length * 42 + 92); const left = 160; const right = 58; const top = 40; const bottom = 42;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom; const max = Math.max(1, ...values.map((entry) => Math.abs(entry.value ?? 0))); const axisMax = niceMax(max);
  const zero = left + plotWidth / 2; let body = `<g class="chart-grid">`;
  for (const tick of [-axisMax, -axisMax / 2, 0, axisMax / 2, axisMax]) { const x = zero + tick / axisMax * (plotWidth / 2); body += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + plotHeight}"/><text x="${x}" y="${height - 17}" text-anchor="middle">${tickLabel(tick)}</text>`; }
  body += `</g><line class="chart-axis" x1="${zero}" y1="${top}" x2="${zero}" y2="${top + plotHeight}"/>`;
  const row = plotHeight / Math.max(values.length, 1);
  values.forEach((entry, index) => {
    const value = entry.value; const y = top + index * row + row * 0.18; const barHeight = row * 0.58;
    body += `<text x="${left - 8}" y="${y + barHeight * .72}" text-anchor="end" class="chart-label">${svgText(entry.label)}</text>`;
    if (value !== null) { const barWidth = Math.abs(value) / axisMax * plotWidth / 2; const x = value < 0 ? zero - barWidth : zero; const colour = value < 0 ? "var(--series-2)" : "var(--series-1)"; body += `<rect class="bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${colour}"/><text class="chart-value" x="${value < 0 ? x - 5 : x + barWidth + 5}" y="${y + barHeight * .72}" text-anchor="${value < 0 ? "end" : "start"}">${tickLabel(value)}${unit}</text>`; }
  });
  return svgRoot(title, body, width, height);
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  return String(value);
}
function table(headers: string[], rows: Array<Array<unknown>>, prose = false): string {
  return `<div class="table-wrap${prose ? " prose" : ""}"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(display(value))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function narrative(sections: ReportSection[], id: SectionId): string {
  const section = sections.find((candidate) => candidate.id === id);
  return `<div class="narrative"><h2>${escapeHtml(section?.title ?? id)}</h2>${section?.bodyHtml ?? "<p>TODO</p>"}</div>`;
}
/** A chart with no caption is a chart nobody reads the same way twice. */
function figure(svg: string, caption: string): string {
  return `<figure>${svg}<figcaption>${renderInline(caption)}</figcaption></figure>`;
}

export const CHART_CAPTIONS = {
  general: "Each scope has its own denominator: 128 all-eight T1–T4 prompt-model cases where available, 32 matched two-model T1–T4 cases, and 10 configured-pool T5 cases. They are never pooled across unequal lane sets.",
  algorithmEntry: "Three heavy prompts × two trials = six checks per model. L6 is 0 of 6 across every model, but its nested classifier cannot authenticate in the sandbox. L7 has no classifier: its Algorithm-read totals are Claude 1/30 and GPT 18/18.",
  algorithmSkip: "The opposite check on trivial work is reported separately; combining it with Algorithm entry would hide the entry result.",
  tokens: "CLI-reported output-token proxy for the 68 cells shared by every version (the configured two-model T5 pool across all tiers). It is not a provider invoice.",
  format: "Configured marker found by the selected-prompt, unanchored full-message regex. The control has no configured marker, so it has no bar.",
  delta: "Count-derived difference on the same 16 T1–T4 prompt outcomes per model: positive means L7 passed more outcomes than RAW.",
  judge: "Scores are bimodal, and the pass bar is 3 of 5 — so every score of 3 counts as a pass.",
} as const;

function markdownCell(value: unknown): string {
  return display(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function markdownTable(headers: string[], rows: Array<Array<unknown>>): string {
  return `| ${headers.map(markdownCell).join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n${rows.map((row) => `| ${headers.map((_, index) => markdownCell(row[index])).join(" | ")} |`).join("\n")}`;
}
function markdownNarrative(sections: ReportSection[], id: SectionId): string {
  const section = sections.find((candidate) => candidate.id === id);
  return `## ${section?.title ?? id}\n\n${section?.bodyMarkdown ?? "TODO"}`;
}
function markdownChart(title: string, caption: string, headers: string[], rows: Array<Array<unknown>>): string {
  return `### ${title}\n\n${caption}\n\n**Chart data**\n\n${markdownTable(headers, rows)}`;
}
function statusText(statuses: Record<string, number>): string { return Object.entries(statuses).map(([status, count]) => `${status}: ${count}`).join(", ") || "—"; }
const GLOSSARY_DESCRIPTIONS: Record<string, string> = {
    algorithm_entry_pct: "Share of selected heavy prompt opportunities where an Algorithm-directory Read was observed. This transcript proxy does not establish read order, an ISA/run, or Algorithm completion.",
    algorithm_skip_pct: "Share of selected trivial prompt opportunities where no Algorithm-directory Read was observed. This asks the opposite question from the heavy-task proxy and is reported separately; L5 Terra is the documented 2/4 exception.",
    mode_marker_pct: "Share of responses carrying the version's own documented mode banner. Null for versions that ship no modes.",
    format_pct: "Configured format marker found on selected checked prompts. The grader searches the full final message with an unanchored regex; this does not establish first-line placement or whole-version compliance.",
    task_prompts: "Prompts this lane was scheduled to run — restricted tiers are absent from the lanes that never ran them, so this is the pass-rate denominator.",
    task_at_k_pct: "Share of scheduled task prompts with at least one passing trial.", task_all_k_pct: "Share of scheduled task prompts whose trials all passed.",
    output_tokens_mean: "Mean CLI-reported output tokens per recorded cell; a usage proxy, not billed usage.", wall_clock_mean_s: "Mean recorded wall-clock seconds per cell; concurrent cells make it non-comparable as elapsed time.",
    cost_usd_total: "CLI-reported API-equivalent cost in US dollars; not an invoice or subscription charge.", hook_files_mean: "Mean captured hook-state files written where recorded; this does not prove every registered hook executed or routed.",
    cells: "Cells with a readable meta.json record.", statuses: "Histogram of meta.status values.",
};
function glossary(data: ReportData): string {
  const keys = Object.keys(data.lanes[0] ?? {}).filter((key) => key in GLOSSARY_DESCRIPTIONS);
  return table(["Data key", "Meaning"], keys.map((key) => [key, GLOSSARY_DESCRIPTIONS[key]!]), true);
}
type DefectData = { fields: string[]; rows: Array<Array<unknown>> };
async function loadDefectData(): Promise<DefectData | null> {
  const file = path("docs", "defects.json");
  if (!(await exists(file))) return null;
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const items = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { defects?: unknown }).defects) ? (parsed as { defects: unknown[] }).defects : []);
  const records = items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  if (!records.length) return null;
  const fields = [...new Set(records.flatMap((item) => Object.keys(item)))];
  return { fields, rows: records.map((item) => fields.map((field) => typeof item[field] === "object" ? JSON.stringify(item[field]) : item[field])) };
}
async function defectTable(): Promise<string> {
  const defects = await loadDefectData();
  return defects ? `<h3>Recorded defects</h3>${table(defects.fields, defects.rows, true)}` : "";
}

export async function renderReportPage(data: ReportData, sections: ReportSection[]): Promise<{ standalone: string; fragment: string }> {
  const matrix = table(["Version", ...data.generated.models], data.generated.versions.map((version) => [version, ...data.generated.models.map((model) => data.lanes.some((lane) => lane.version === version && lane.model === model) ? "run" : "—")]));
  const trials = table(["Tier", "Trials", "Models"], Object.entries(data.generated.trials).map(([tier, trial]) => [tier, trial, data.generated.tier_models[tier]?.join(", ") ?? "all lane models"]));
  const runTiles = `<div class="tiles"><div><b>${data.run.cells_total}</b><span>recorded cells</span></div><div><b>${data.run.statuses.success ?? 0}</b><span>successful cells</span></div><div><b>$${data.run.api_equivalent_cost_usd}</b><span>CLI-reported API-equivalent cost</span></div><div><b>${data.run.cumulative_cell_hours} h</b><span>cumulative cell-hours</span></div></div>`;
  const versionRuns = table(["Version", "Cells", "Statuses"], data.versions.map((version) => [version.version, version.cells, statusText(version.statuses)]));
  const modelLabels = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
  const laneFor = (version: string, model: string) => data.lanes.find((lane) => lane.version === version && lane.model === model);
  const byVersion = (pick: (lane: LaneRecord) => Numeric) =>
    data.generated.versions.map((version) => ({ label: version, values: modelLabels.map((model) => { const lane = laneFor(version, model); return lane ? pick(lane) : null; }) }));

  const outcome = (version: string, scope: ReportData["outcome_summaries"][number]["scope"]) =>
    data.outcome_summaries.find((entry) => entry.version === version && entry.scope === scope);
  const outcomeTable = table(
    ["Version", "Scope", "Tiers", "Prompt-model cases", "Succeeded in at least one trial", "Succeeded in every trial", "At least one trial %", "Every trial %"],
    data.outcome_summaries.map((entry) => [entry.version, entry.scope, entry.tiers, entry.prompt_model_cases, entry.at_k_pass, entry.all_k_pass, entry.at_k, entry.all_k]));
  const generalChart = figure(
    groupedBarChart("Task outcomes succeeding in at least one trial, by comparable scope", ["T1–T4 all eight", "T1–T4 matched", "T5 configured pool"],
      data.generated.versions.map((version) => ({ label: version,
        values: [outcome(version, "all eight models")?.at_k ?? null, outcome(version, "matched two-model pool")?.at_k ?? null, outcome(version, "T5 configured pool")?.at_k ?? null] }))),
    CHART_CAPTIONS.general);

  const algorithmChart = figure(
    groupedBarChart("Algorithm-directory Read observed on selected heavy prompts", modelLabels, byVersion((lane) => lane.algorithm_entry_pct)),
    CHART_CAPTIONS.algorithmEntry);
  const algorithmSkipChart = figure(
    groupedBarChart("No Algorithm-directory Read observed on selected trivial prompts", modelLabels, byVersion((lane) => lane.algorithm_skip_pct)),
    CHART_CAPTIONS.algorithmSkip);

  const familyAlgorithmTable = table(["Version", "Model family", "Algorithm-directory Reads observed", "Share %"],
    data.algorithm_families.map((entry) => [entry.version, entry.family, `${entry.pass}/${entry.total}`, entry.pct]));
  const hookEvidenceTable = table(["Version", "Hook payload present", "Active registration present", "Runtime execution evidence", "Routing responsibility", "Algorithm-directory Read observed"],
    data.hook_evidence.map((entry) => [entry.version, entry.hook_payload, entry.active_registration, entry.runtime_execution, entry.routing_responsibility, entry.algorithm_directory_read]), true);
  const tokenChart = figure(
    simpleBarChart("Mean CLI-reported output tokens per matched cell", data.matched_versions.map((version) => ({ label: version.version, value: version.output_tokens_mean }))),
    CHART_CAPTIONS.tokens);
  const formatChart = figure(
    groupedBarChart("Configured format marker found on selected checked prompts", modelLabels, byVersion((lane) => lane.format_pct)),
    CHART_CAPTIONS.format);

  const deltaChart = figure(
    divergingBarChart("L7 minus RAW, T1–T4 outcomes succeeding in at least one trial (16 cases/model)", data.raw_vs_l7.map((row) => ({ label: row.model, value: row.delta_at_k }))),
    CHART_CAPTIONS.delta);

  const judgeChart = figure(
    simpleBarChart("Judge score distribution", Object.entries(data.judge.score_histogram).map(([score, count]) => ({ label: score, value: count }))),
    CHART_CAPTIONS.judge);

  const laneHeaders = ["Version", "Model", "Prompts", "Algorithm-directory Read observed %", "No Algorithm-directory Read observed %", "Mode markers %", "Format marker found %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"];
  const laneTable = table(laneHeaders, data.lanes.map((lane) => [lane.version, lane.model, lane.task_prompts, lane.algorithm_entry_pct, lane.algorithm_skip_pct, lane.mode_marker_pct, lane.format_pct, lane.task_at_k_pct, lane.task_all_k_pct, lane.cells, lane.output_tokens_mean, lane.wall_clock_mean_s, lane.cost_usd_total, lane.hook_files_mean, statusText(lane.statuses)]));
  const tierTable = table(["Version", "Model", "Tier", "Prompts", "Algorithm-directory Read observed %", "No Algorithm-directory Read observed %", "Mode markers %", "Format marker found %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD"], data.tiers.map((tier) => [tier.version, tier.model, tier.tier, tier.task_prompts, tier.algorithm_entry_pct, tier.algorithm_skip_pct, tier.mode_marker_pct, tier.format_pct, tier.task_at_k_pct, tier.task_all_k_pct, tier.cells, tier.output_tokens_mean, tier.wall_clock_mean_s, tier.cost_usd_total]));
  const defects = await defectTable();
  // Three theme states, not two. An explicit viewer choice stamps data-theme on the root; the
  // default "system" setting stamps nothing, so only prefers-color-scheme separates the two
  // there. Every colour is defined on bare :root and only REDEFINED in the other two blocks —
  // a colour whose sole definition sits behind a media query never applies in the unstamped
  // state, which is how a page ends up rendering one theme's text on the other theme's ground.
  const dark = "--bg:#111724; --surface:#1b2434; --text:#edf2fc; --muted:#b4c0d4; --border:#3a4961; --accent:#9ab9ff; --accent-soft:#21365f; --series-1:#9ab9ff; --series-2:#ffaaa3; --series-3:#8cd4a1; --series-4:#f0c56e; --grid:#3a4961; --shadow:0 0.25rem 1rem rgb(0 0 0 / 35%);";
  const style = `<style>
:root { --bg:#f5f7fa; --surface:#ffffff; --text:#151d2b; --muted:#4f5d73; --border:#c9d2e0; --accent:#2f56ad; --accent-soft:#e7edfb; --series-1:#2f56ad; --series-2:#b04a47; --series-3:#3d7f56; --series-4:#8f6417; --grid:#dae0ea; --shadow:0 0.25rem 1rem rgb(21 29 43 / 7%);
  --display: ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif;
  --body: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --data: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
:root[data-theme="dark"] { ${dark} }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:1rem/1.6 var(--body); overflow-x:hidden; }
main { width:min(100% - 2rem, 78rem); margin:0 auto; }
header { padding:3.5rem 0 1.5rem; }
h1 { margin:0 0 .5rem; font-family:var(--display); font-weight:600; font-size:clamp(1.9rem,5vw,3.1rem); line-height:1.08; letter-spacing:-0.015em; text-wrap:balance; }
header p { margin:0; color:var(--muted); font-size:.95rem; }
h2 { margin:0 0 .75rem; font-family:var(--display); font-weight:600; font-size:clamp(1.3rem,3vw,1.75rem); line-height:1.2; text-wrap:balance; }
h3 { margin:1.75rem 0 .5rem; font-size:1.02rem; font-weight:650; text-wrap:balance; }
p { margin:0 0 .9rem; } li { margin-bottom:.35rem; }
section { display:flex; flex-direction:column; margin:1.25rem 0; padding:clamp(1.1rem,3vw,2.25rem); background:var(--surface); border:1px solid var(--border); border-radius:.6rem; box-shadow:var(--shadow); }
.narrative { max-width:70ch; }
.table-wrap { max-width:100%; overflow-x:auto; margin:.75rem 0 1.25rem; }
table { width:100%; border-collapse:collapse; font-size:.88rem; font-variant-numeric:tabular-nums; }
th,td { padding:.5rem .7rem; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; white-space:nowrap; }
th { color:var(--muted); font-weight:600; font-size:.72rem; letter-spacing:.06em; text-transform:uppercase; }
td { font-family:var(--data); font-size:.83rem; }
.prose th,.prose td { white-space:normal; } .prose td { font-family:var(--body); font-size:.88rem; } .prose td:last-child { min-width:22rem; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.75rem; margin:.5rem 0 1rem; }
.tiles div { padding:1rem; border-radius:.4rem; background:var(--accent-soft); }
.tiles b,.tiles span { display:block; }
.tiles b { font-family:var(--data); font-size:1.5rem; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
.tiles span { color:var(--muted); font-size:.8rem; }
svg { display:block; max-width:100%; margin:.75rem 0 2rem; }
.chart-grid line { stroke:var(--grid); stroke-width:1; }
.chart-axis { stroke:var(--muted); stroke-width:1; }
svg text { fill:var(--muted); font:11px var(--data); }
svg .chart-value { fill:var(--text); font-size:10px; }
svg .chart-label { font-size:10px; font-family:var(--body); }
svg .chart-legend { font-family:var(--body); }
a { color:var(--accent); }
a:focus-visible, :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
code { padding:.1em .3em; font-family:var(--data); font-size:.88em; background:var(--accent-soft); border-radius:.2em; }
blockquote { border-left:.2rem solid var(--accent); margin-left:0; padding-left:1rem; color:var(--muted); }
footer { color:var(--muted); padding:1rem 0 3rem; font-size:.82rem; }
@media (max-width:38rem) { main { width:min(100% - 1rem,78rem); } section { border-radius:.4rem; } }
</style>`;
  const promptTable = table(["Tier", "Prompt id", "What the model was asked", "Checks"],
    data.generated.prompts.map((prompt) => [prompt.tier, prompt.id, prompt.prompt, prompt.checks.join(", ")]), true);
  const body = `<main><header><h1>Does LifeOS actually help?</h1><p>T1–T4 ran across eight models; T5 ran only on Sonnet/Terra. Three released LifeOS versions were measured against a bare control on a frozen 21-prompt set · golden set ${escapeHtml(data.generated.golden_set)} · aggregate results only</p></header>
<section id="summary">${narrative(sections, "summary")}</section>
<section id="general">${narrative(sections, "general")}${generalChart}<h3>Comparable outcome summaries</h3>${outcomeTable}${formatChart}</section>
<section id="personalization">${narrative(sections, "personalization")}</section>
<section id="algorithm">${narrative(sections, "algorithm")}${familyAlgorithmTable}${algorithmChart}${algorithmSkipChart}</section>
<section id="cost">${narrative(sections, "cost")}${tokenChart}${deltaChart}</section>
<section id="limits">${narrative(sections, "limits")}</section>
<section id="method">${narrative(sections, "method")}<h3>The versions under test</h3>${matrix}<h3>Trials per tier</h3>${trials}<h3>The complete prompt set</h3>${promptTable}<h3>What was run</h3>${runTiles}${versionRuns}<h3>Hook evidence</h3>${hookEvidenceTable}</section>
<section id="audit">${narrative(sections, "audit")}${judgeChart}${defects}</section>
<section id="appendix">${narrative(sections, "appendix")}<h3>Metric glossary</h3>${glossary(data)}<h3>Every lane</h3>${laneTable}<h3>Every lane by tier</h3>${tierTable}</section>
<footer>Every figure is regenerated from the recorded per-cell artifacts by one shared aggregation module. No individual transcripts or workspaces are included.</footer></main>`;
  const title = "lifeos-bench — does the scaffolding actually help?";
  const standalone = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${style}</head><body>${body}</body></html>\n`;
  // The Artifact host supplies its own document skeleton, so that variant carries the title,
  // the styles and the content — and none of the wrapper tags, which would otherwise nest.
  const fragment = `<title>${title}</title>\n${style}\n${body}\n`;
  // Narrative and defect notes are human-authored, so an operator path can reach the page through
  // prose. Fail loudly rather than redacting: a silent scrub turns a containment breach into a
  // cosmetic edit, and the whole point of the gate is that a breach is visible.
  for (const output of [standalone, fragment]) {
    if (/\/Users\//.test(output)) throw new Error("report page contains an operator path — fix the source, not the output");
  }
  return { standalone, fragment };
}

export async function renderReportMarkdown(data: ReportData, sections: ReportSection[]): Promise<string> {
  const matrixRows = data.generated.versions.map((version) => [version, ...data.generated.models.map((model) =>
    data.lanes.some((lane) => lane.version === version && lane.model === model) ? "run" : "—")]);
  const trialRows = Object.entries(data.generated.trials).map(([tier, trial]) =>
    [tier, trial, data.generated.tier_models[tier]?.join(", ") ?? "all lane models"]);
  const modelLabels = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
  const laneFor = (version: string, model: string) => data.lanes.find((lane) => lane.version === version && lane.model === model);
  // The chart tables below are the Markdown equivalent of the HTML SVGs and retain the
  // same ReportData lookup as their visual counterparts.
  const chartRows = (pick: (lane: LaneRecord) => Numeric) => data.generated.versions.map((version) =>
    [version, ...modelLabels.map((model) => { const lane = laneFor(version, model); return lane ? pick(lane) : null; })]);
  const outcome = (version: string, scope: ReportData["outcome_summaries"][number]["scope"]) =>
    data.outcome_summaries.find((entry) => entry.version === version && entry.scope === scope);
  const generalRows = data.generated.versions.map((version) => [version,
    outcome(version, "all eight models")?.at_k ?? null,
    outcome(version, "matched two-model pool")?.at_k ?? null,
    outcome(version, "T5 configured pool")?.at_k ?? null]);
  const outcomeRows = data.outcome_summaries.map((entry) => [entry.version, entry.scope, entry.tiers, entry.prompt_model_cases, entry.at_k_pass, entry.all_k_pass, entry.at_k, entry.all_k]);
  const familyAlgorithmRows = data.algorithm_families.map((entry) => [entry.version, entry.family, `${entry.pass}/${entry.total}`, entry.pct]);
  const laneHeaders = ["Version", "Model", "Prompts", "Algorithm-directory Read observed %", "No Algorithm-directory Read observed %", "Mode markers %", "Format marker found %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"];
  const laneRows = data.lanes.map((lane) => [lane.version, lane.model, lane.task_prompts, lane.algorithm_entry_pct, lane.algorithm_skip_pct, lane.mode_marker_pct, lane.format_pct, lane.task_at_k_pct, lane.task_all_k_pct, lane.cells, lane.output_tokens_mean, lane.wall_clock_mean_s, lane.cost_usd_total, lane.hook_files_mean, statusText(lane.statuses)]);
  const tierHeaders = ["Version", "Model", "Tier", "Prompts", "Algorithm-directory Read observed %", "No Algorithm-directory Read observed %", "Mode markers %", "Format marker found %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD"];
  const tierRows = data.tiers.map((tier) => [tier.version, tier.model, tier.tier, tier.task_prompts, tier.algorithm_entry_pct, tier.algorithm_skip_pct, tier.mode_marker_pct, tier.format_pct, tier.task_at_k_pct, tier.task_all_k_pct, tier.cells, tier.output_tokens_mean, tier.wall_clock_mean_s, tier.cost_usd_total]);
  const defects = await loadDefectData();

  const parts = [
    "# Does LifeOS actually help?",
    `T1–T4 ran across eight models; T5 ran only on Sonnet/Terra. Three released LifeOS versions were measured against a bare control on a frozen 21-prompt set · golden set ${data.generated.golden_set} · aggregate results only`,
    markdownNarrative(sections, "summary"),
    markdownNarrative(sections, "general"),
    markdownChart("Task outcomes succeeding in at least one trial, by comparable scope", CHART_CAPTIONS.general, ["Version", "T1–T4 all eight %", "T1–T4 matched %", "T5 configured-pool %"], generalRows),
    "### Comparable outcome summaries",
    markdownTable(["Version", "Scope", "Tiers", "Prompt-model cases", "Succeeded in at least one trial", "Succeeded in every trial", "At least one trial %", "Every trial %"], outcomeRows),
    markdownChart("Configured format marker found on selected checked prompts", CHART_CAPTIONS.format, ["Version", ...modelLabels], chartRows((lane) => lane.format_pct)),

    markdownNarrative(sections, "personalization"),
    markdownNarrative(sections, "algorithm"),
    "### Algorithm-read totals by model family",
    markdownTable(["Version", "Model family", "Algorithm-directory Reads observed", "Share %"], familyAlgorithmRows),
    markdownChart("Algorithm-directory Read observed on selected heavy prompts", CHART_CAPTIONS.algorithmEntry, ["Version", ...modelLabels], chartRows((lane) => lane.algorithm_entry_pct)),
    markdownChart("No Algorithm-directory Read observed on selected trivial prompts", CHART_CAPTIONS.algorithmSkip, ["Version", ...modelLabels], chartRows((lane) => lane.algorithm_skip_pct)),
    markdownNarrative(sections, "cost"),
    markdownChart("Mean CLI-reported output tokens per matched cell", CHART_CAPTIONS.tokens, ["Version", "Tokens mean", "Matched cells"], data.matched_versions.map((version) => [version.version, version.output_tokens_mean, version.cells])),
    markdownChart("L7 minus RAW, T1–T4 outcomes succeeding in at least one trial (16 cases/model)", CHART_CAPTIONS.delta, ["Model", "Prompt-model cases", "RAW pass", "L7 pass", "Delta passes", "Delta pp"], data.raw_vs_l7.map((row) => [row.model, row.prompt_model_cases, row.raw_pass, row.l7_pass, row.delta_pass, row.delta_at_k])),
    markdownNarrative(sections, "limits"),
    markdownNarrative(sections, "method"),
    "### The versions under test",
    markdownTable(["Version", ...data.generated.models], matrixRows),
    "### Trials per tier",
    markdownTable(["Tier", "Trials", "Models"], trialRows),
    "### The complete prompt set",
    markdownTable(["Tier", "Prompt id", "What the model was asked", "Checks"], data.generated.prompts.map((prompt) => [prompt.tier, prompt.id, prompt.prompt, prompt.checks.join(", ")])),
    "### What was run",
    markdownTable(["Recorded cells", "Successful cells", "CLI-reported API-equivalent cost USD", "Cumulative cell-hours"], [[data.run.cells_total, data.run.statuses.success ?? 0, data.run.api_equivalent_cost_usd, data.run.cumulative_cell_hours]]),
    markdownTable(["Version", "Cells", "Statuses"], data.versions.map((version) => [version.version, version.cells, statusText(version.statuses)])),
    "### Hook evidence",
    markdownTable(["Version", "Hook payload present", "Active registration present", "Runtime execution evidence", "Routing responsibility", "Algorithm-directory Read observed"], data.hook_evidence.map((entry) => [entry.version, entry.hook_payload, entry.active_registration, entry.runtime_execution, entry.routing_responsibility, entry.algorithm_directory_read])),
    markdownNarrative(sections, "audit"),
    markdownChart("Judge score distribution", CHART_CAPTIONS.judge, ["Score", "Verdicts"], Object.entries(data.judge.score_histogram).map(([score, count]) => [score, count])),
    ...(defects ? ["### Recorded defects", markdownTable(defects.fields, defects.rows)] : []),
    markdownNarrative(sections, "appendix"),
    "### Metric glossary",
    markdownTable(["Data key", "Meaning"], Object.keys(data.lanes[0] ?? {}).filter((key) => key in GLOSSARY_DESCRIPTIONS).map((key) => [key, GLOSSARY_DESCRIPTIONS[key]!])),
    "### Every lane",
    markdownTable(laneHeaders, laneRows),
    "### Every lane by tier",
    markdownTable(tierHeaders, tierRows),
    "Every figure is regenerated from the recorded per-cell artifacts by one shared aggregation module. No individual transcripts or workspaces are included.",
  ];
  return `${parts.join("\n\n")}\n`;
}

export async function buildReportOutputs(): Promise<{ data: ReportData; page: { standalone: string; fragment: string }; markdown: string }> {
  const data = await buildReportData();
  const docs = path("docs");
  await ensure(docs);
  const sections = await loadSections(join(docs, "report-sections.md"));
  const page = await renderReportPage(data, sections);
  const markdown = await renderReportMarkdown(data, sections);
  return { data, page, markdown };
}

async function main(): Promise<void> {
  const output = await buildReportOutputs();
  await writeFile(path("docs", "report-data.json"), JSON.stringify(output.data, null, 2) + "\n", "utf8");
  await writeFile(path("docs", "report.html"), output.page.standalone, "utf8");
  await writeFile(path("docs", "report-artifact.html"), output.page.fragment, "utf8");
  await writeFile(path("docs", "report.md"), output.markdown, "utf8");
  console.log(JSON.stringify({
    data: "docs/report-data.json",
    page: "docs/report.html",
    markdown: "docs/report.md",
    artifact: "docs/report-artifact.html",
    bytes: { html: Buffer.byteLength(output.page.standalone), markdown: Buffer.byteLength(output.markdown) },
  }));
}

if (import.meta.main) await main();
