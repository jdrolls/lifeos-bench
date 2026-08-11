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

const SECTION_IDS = ["question", "design", "degraded", "algorithm", "versions", "models", "unmeasured", "conclusions", "caveats", "appendix"] as const;
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
  raw_vs_l7: Array<{ model: string; raw_at_k: Numeric; l7_at_k: Numeric; delta_at_k: Numeric; raw_all_k: Numeric; l7_all_k: Numeric; delta_all_k: Numeric }>;
  tier_groups: Array<{ version: string; scope: string; group: string; prompts: number; at_k: Numeric; all_k: Numeric }>;
  judge: { rows: number; pass: number; fail: number; errors: number; score_histogram: Record<string, number>; by_version: Record<string, { rows: number; pass: number; fail: number; errors: number }> };
  run: { cells_total: number; statuses: Record<string, number>; wall_clock_total_h: number; cost_usd_total: number; pending_judge: number };
};

type BarValue = { label: string; value: Numeric };
type GroupedSeries = { label: string; values: Numeric[] };

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

function difference(left: Numeric, right: Numeric): Numeric {
  return left === null || right === null ? null : rounded(right - left, 1);
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
  const raw_vs_l7 = config.models.flatMap((model) => {
    const raw = lanes.find((lane) => lane.version === "RAW" && lane.model === model.id);
    const l7 = lanes.find((lane) => lane.version === "L7" && lane.model === model.id);
    return raw && l7 ? [{ model: model.id, raw_at_k: raw.task_at_k_pct, l7_at_k: l7.task_at_k_pct,
      delta_at_k: difference(raw.task_at_k_pct, l7.task_at_k_pct), raw_all_k: raw.task_all_k_pct,
      l7_all_k: l7.task_all_k_pct, delta_all_k: difference(raw.task_all_k_pct, l7.task_all_k_pct) }] : [];
  });
  // Every lane ran T1-T4; only the two bisect models ran T5. Rolling those together would
  // compare a version measured on 21 prompts against one measured on 16, so the two scopes are
  // reported separately and never summed.
  const bisectModels = config.tier_models?.T5 ?? config.models.map((model) => model.id);
  const tier_groups = config.versions.flatMap((version) => {
    const groups: Array<{ label: string; tiers: string[]; models: string[]; scope: string }> = [
      { label: "T1-T4", tiers: ["T1", "T2", "T3", "T4"], models: bisectModels, scope: "bisect models" },
      { label: "T5", tiers: ["T5"], models: bisectModels, scope: "bisect models" },
      { label: "T1-T4", tiers: ["T1", "T2", "T3", "T4"], models: config.models.map((model) => model.id).filter((model) => !bisectModels.includes(model)), scope: "model sweep" },
    ];
    return groups.flatMap((group) => {
      const rows = tiers.filter((tier) => tier.version === version.id && group.tiers.includes(tier.tier) && group.models.includes(tier.model));
      const prompts = rows.reduce((total, tier) => total + tier.task_prompts, 0);
      if (!prompts) return [];
      const any = rows.reduce((total, tier) => total + tier.any_pass, 0);
      const all = rows.reduce((total, tier) => total + tier.all_pass, 0);
      return [{ version: version.id, scope: group.scope, group: group.label, prompts, at_k: roundedPercent(any, prompts), all_k: roundedPercent(all, prompts) }];
    });
  });

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
    lanes, tiers, versions, raw_vs_l7, tier_groups,
    judge: await judgeSummary(resultsRoot, config.versions.map((version) => version.id)),
    run: { cells_total: allCells, statuses: sumStatuses(lanes), wall_clock_total_h: rounded(allWall / 3_600_000, 2), cost_usd_total: rounded(allCost, 2), pending_judge: rows.filter((row) => row.status === "pending_judge").length },
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
  general: "Left group: the four general tiers. Right group: personalization. The control (RAW) leads on general work and collapses on personalization; every LifeOS version does the reverse.",
  algorithmEntry: "Three heavy prompts × two trials = six checks per lane. RAW has no Algorithm, so it has no bar. **L5 enters reliably. L6 is 0 of 6 across every model, with the nested-`claude` credential confound. Under L7, four Claude models are 0 of 6, Fable is 1 of 6, and every GPT model is 6 of 6.**",
  algorithmSkip: "The same grader asking the opposite question on four trivial prompts. Near-perfect everywhere — which is exactly why averaging it with the chart above hides the result.",
  tokens: "What each version costs in generated tokens for the same 21 prompts. L5 spends 4–5× what L6, L7 or the bare control spend.",
  format: "Whether each response opened with the version's own documented format contract. The control has none to honour, so it has no bar.",
  delta: "Positive means LifeOS 7 beat the bare control on that model. One prompt is worth 4.8–6.3 points here, so only sonnet-5 and gpt-5.6-sol sit outside the noise band.",
  hooks: "Evidence that the hook layer actually ran, recorded per cell. The control registers no hooks and writes nothing; every LifeOS version writes 22–25 files per cell.",
  judge: "Scores are bimodal, and the pass bar is 3 of 5 — so every score of 3 counts as a pass. The chart data carries the current distribution; the caveat above records the exact threshold sensitivity.",
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
    algorithm_entry_pct: "Share of HEAVY prompts where the version read its Algorithm before starting work. Three prompts, two trials each.",
    algorithm_skip_pct: "Share of TRIVIAL prompts where it correctly did NOT read the Algorithm. Every version passes these, which is why they are a separate column.",
    mode_marker_pct: "Share of responses carrying the version's own documented mode banner. Null for versions that ship no modes.",
    format_pct: "Share of applicable output-format checks that passed.",
    task_prompts: "Prompts this lane was scheduled to run — restricted tiers are absent from the lanes that never ran them, so this is the pass-rate denominator.",
    task_at_k_pct: "Share of scheduled task prompts with at least one passing trial.", task_all_k_pct: "Share of scheduled task prompts whose trials all passed.",
    output_tokens_mean: "Mean generated output tokens per recorded cell.", wall_clock_mean_s: "Mean recorded wall-clock seconds per cell.",
    cost_usd_total: "Recorded total cost in US dollars.", hook_files_mean: "Mean hook-state files written where recorded.",
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
  const runTiles = `<div class="tiles"><div><b>${data.run.cells_total}</b><span>recorded cells</span></div><div><b>${data.run.statuses.success ?? 0}</b><span>successful cells</span></div><div><b>$${data.run.cost_usd_total}</b><span>recorded cost</span></div><div><b>${data.run.wall_clock_total_h} h</b><span>recorded wall-clock</span></div></div>`;
  const versionRuns = table(["Version", "Cells", "Statuses"], data.versions.map((version) => [version.version, version.cells, statusText(version.statuses)]));
  const modelLabels = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
  const laneFor = (version: string, model: string) => data.lanes.find((lane) => lane.version === version && lane.model === model);
  const byVersion = (pick: (lane: LaneRecord) => Numeric) =>
    data.generated.versions.map((version) => ({ label: version, values: modelLabels.map((model) => { const lane = laneFor(version, model); return lane ? pick(lane) : null; }) }));

  const groupRow = (version: string, scope: string, group: string) =>
    data.tier_groups.find((entry) => entry.version === version && entry.scope === scope && entry.group === group);
  const tierGroupTable = table(
    ["Version", "Scope", "Tiers", "Prompts", "pass@k %", "pass^k %"],
    data.tier_groups.map((entry) => [entry.version, entry.scope, entry.group, entry.prompts, entry.at_k, entry.all_k]));
  const generalChart = figure(
    groupedBarChart("Task pass@k on T1–T4 and on T5, by version", ["T1–T4 (bisect models)", "T5 personalization"],
      data.generated.versions.map((version) => ({ label: version,
        values: [groupRow(version, "bisect models", "T1-T4")?.at_k ?? null, groupRow(version, "bisect models", "T5")?.at_k ?? null] }))),
    CHART_CAPTIONS.general);

  const algorithmChart = figure(
    groupedBarChart("Did the version enter the Algorithm before heavy work?", modelLabels, byVersion((lane) => lane.algorithm_entry_pct)),
    CHART_CAPTIONS.algorithmEntry);
  const algorithmSkipChart = figure(
    groupedBarChart("Did it correctly STAY OUT of the Algorithm on trivial work?", modelLabels, byVersion((lane) => lane.algorithm_skip_pct)),
    CHART_CAPTIONS.algorithmSkip);

  const tokenChart = figure(
    simpleBarChart("Mean output tokens generated per cell, by version", data.versions.map((version) => ({ label: version.version, value: version.output_tokens_mean }))),
    CHART_CAPTIONS.tokens);
  const formatChart = figure(
    groupedBarChart("Output-format compliance, by version and model", modelLabels, byVersion((lane) => lane.format_pct)),
    CHART_CAPTIONS.format);

  const deltaChart = figure(
    divergingBarChart("L7 minus the bare control, task pass@k", data.raw_vs_l7.map((row) => ({ label: row.model, value: row.delta_at_k }))),
    CHART_CAPTIONS.delta);

  const hookChart = figure(
    simpleBarChart("Enforcement-layer state files written per cell, by version", data.versions.map((version) => ({ label: version.version, value: version.hook_files_mean }))),
    CHART_CAPTIONS.hooks);
  const judgeChart = figure(
    simpleBarChart("Judge score distribution", Object.entries(data.judge.score_histogram).map(([score, count]) => ({ label: score, value: count }))),
    CHART_CAPTIONS.judge);

  const laneHeaders = ["Version", "Model", "Prompts", "Algorithm entered %", "Algorithm skipped %", "Mode markers %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"];
  const laneTable = table(laneHeaders, data.lanes.map((lane) => [lane.version, lane.model, lane.task_prompts, lane.algorithm_entry_pct, lane.algorithm_skip_pct, lane.mode_marker_pct, lane.format_pct, lane.task_at_k_pct, lane.task_all_k_pct, lane.cells, lane.output_tokens_mean, lane.wall_clock_mean_s, lane.cost_usd_total, lane.hook_files_mean, statusText(lane.statuses)]));
  const tierTable = table(["Version", "Model", "Tier", "Prompts", "Algorithm entered %", "Algorithm skipped %", "Mode markers %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD"], data.tiers.map((tier) => [tier.version, tier.model, tier.tier, tier.task_prompts, tier.algorithm_entry_pct, tier.algorithm_skip_pct, tier.mode_marker_pct, tier.format_pct, tier.task_at_k_pct, tier.task_all_k_pct, tier.cells, tier.output_tokens_mean, tier.wall_clock_mean_s, tier.cost_usd_total]));
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
  const body = `<main><header><h1>Does LifeOS actually help?</h1><p>Three released versions of LifeOS measured against a bare control, across eight models, on a frozen set of 21 prompts · golden set ${escapeHtml(data.generated.golden_set)} · aggregate results only</p></header>
<section id="question">${narrative(sections, "question")}</section>
<section id="design">${narrative(sections, "design")}<h3>The versions under test</h3>${matrix}<h3>Trials per tier</h3>${trials}<h3>The complete prompt set</h3>${promptTable}<h3>What was run</h3>${runTiles}${versionRuns}${hookChart}</section>
<section id="degraded">${narrative(sections, "degraded")}${generalChart}<h3>Pass-rates by tier group</h3>${tierGroupTable}${formatChart}</section>
<section id="algorithm">${narrative(sections, "algorithm")}${algorithmChart}${algorithmSkipChart}</section>
<section id="versions">${narrative(sections, "versions")}${tokenChart}</section>
<section id="models">${narrative(sections, "models")}${deltaChart}</section>
<section id="unmeasured">${narrative(sections, "unmeasured")}</section>
<section id="conclusions">${narrative(sections, "conclusions")}</section>
<section id="caveats">${narrative(sections, "caveats")}${judgeChart}${defects}</section>
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
  const groupRow = (version: string, scope: string, group: string) =>
    data.tier_groups.find((entry) => entry.version === version && entry.scope === scope && entry.group === group);
  const generalRows = data.generated.versions.map((version) => [version,
    groupRow(version, "bisect models", "T1-T4")?.at_k ?? null,
    groupRow(version, "bisect models", "T5")?.at_k ?? null]);
  const tierGroupRows = data.tier_groups.map((entry) => [entry.version, entry.scope, entry.group, entry.prompts, entry.at_k, entry.all_k]);
  const laneHeaders = ["Version", "Model", "Prompts", "Algorithm entered %", "Algorithm skipped %", "Mode markers %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"];
  const laneRows = data.lanes.map((lane) => [lane.version, lane.model, lane.task_prompts, lane.algorithm_entry_pct, lane.algorithm_skip_pct, lane.mode_marker_pct, lane.format_pct, lane.task_at_k_pct, lane.task_all_k_pct, lane.cells, lane.output_tokens_mean, lane.wall_clock_mean_s, lane.cost_usd_total, lane.hook_files_mean, statusText(lane.statuses)]);
  const tierHeaders = ["Version", "Model", "Tier", "Prompts", "Algorithm entered %", "Algorithm skipped %", "Mode markers %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD"];
  const tierRows = data.tiers.map((tier) => [tier.version, tier.model, tier.tier, tier.task_prompts, tier.algorithm_entry_pct, tier.algorithm_skip_pct, tier.mode_marker_pct, tier.format_pct, tier.task_at_k_pct, tier.task_all_k_pct, tier.cells, tier.output_tokens_mean, tier.wall_clock_mean_s, tier.cost_usd_total]);
  const defects = await loadDefectData();

  const parts = [
    "# Does LifeOS actually help?",
    `Three released versions of LifeOS measured against a bare control, across eight models, on a frozen set of 21 prompts · golden set ${data.generated.golden_set} · aggregate results only`,
    markdownNarrative(sections, "question"),
    markdownNarrative(sections, "design"),
    "### The versions under test",
    markdownTable(["Version", ...data.generated.models], matrixRows),
    "### Trials per tier",
    markdownTable(["Tier", "Trials", "Models"], trialRows),
    "### The complete prompt set",
    markdownTable(["Tier", "Prompt id", "What the model was asked", "Checks"], data.generated.prompts.map((prompt) => [prompt.tier, prompt.id, prompt.prompt, prompt.checks.join(", ")])),
    "### What was run",
    markdownTable(["Recorded cells", "Successful cells", "Recorded cost USD", "Recorded wall-clock hours"], [[data.run.cells_total, data.run.statuses.success ?? 0, data.run.cost_usd_total, data.run.wall_clock_total_h]]),
    markdownTable(["Version", "Cells", "Statuses"], data.versions.map((version) => [version.version, version.cells, statusText(version.statuses)])),
    markdownChart("Enforcement-layer state files written per cell, by version", CHART_CAPTIONS.hooks, ["Version", "Hook files mean"], data.versions.map((version) => [version.version, version.hook_files_mean])),
    markdownNarrative(sections, "degraded"),
    markdownChart("Task pass@k on T1–T4 and on T5, by version", CHART_CAPTIONS.general, ["Version", "T1–T4 (bisect models) pass@k %", "T5 personalization pass@k %"], generalRows),
    "### Pass-rates by tier group",
    markdownTable(["Version", "Scope", "Tiers", "Prompts", "pass@k %", "pass^k %"], tierGroupRows),
    markdownChart("Output-format compliance, by version and model", CHART_CAPTIONS.format, ["Version", ...modelLabels], chartRows((lane) => lane.format_pct)),
    markdownNarrative(sections, "algorithm"),
    markdownChart("Did the version enter the Algorithm before heavy work?", CHART_CAPTIONS.algorithmEntry, ["Version", ...modelLabels], chartRows((lane) => lane.algorithm_entry_pct)),
    markdownChart("Did it correctly STAY OUT of the Algorithm on trivial work?", CHART_CAPTIONS.algorithmSkip, ["Version", ...modelLabels], chartRows((lane) => lane.algorithm_skip_pct)),
    markdownNarrative(sections, "versions"),
    markdownChart("Mean output tokens generated per cell, by version", CHART_CAPTIONS.tokens, ["Version", "Tokens mean"], data.versions.map((version) => [version.version, version.output_tokens_mean])),
    markdownNarrative(sections, "models"),
    markdownChart("L7 minus the bare control, task pass@k", CHART_CAPTIONS.delta, ["Model", "L7 minus RAW pass@k (pp)"], data.raw_vs_l7.map((row) => [row.model, row.delta_at_k])),
    markdownNarrative(sections, "unmeasured"),
    markdownNarrative(sections, "conclusions"),
    markdownNarrative(sections, "caveats"),
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
