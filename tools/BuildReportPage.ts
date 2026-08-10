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

const SECTION_IDS = ["question", "method", "run", "findings", "reading", "corrections", "limitations", "appendix"] as const;
type SectionId = typeof SECTION_IDS[number];

export type ReportSection = { id: string; title: string; bodyHtml: string };
type Numeric = number | null;
type DisplayMetrics = {
  routing_pct: Numeric; routing_pass: number; routing_total: number;
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
  task_at_k_pct: Numeric; format_pct: Numeric; routing_pct: Numeric;
};
export type ReportData = {
  generated: { golden_set: string; grade_rows: number; versions: string[]; models: string[]; trials: Record<string, number>; tier_models: Record<string, string[]> };
  lanes: LaneRecord[]; tiers: TierRecord[]; versions: VersionRecord[];
  raw_vs_l7: Array<{ model: string; raw_at_k: Numeric; l7_at_k: Numeric; delta_at_k: Numeric; raw_all_k: Numeric; l7_all_k: Numeric; delta_all_k: Numeric }>;
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
    routing_pct: roundedPercent(metrics.routingPass, metrics.routingTotal), routing_pass: metrics.routingPass, routing_total: metrics.routingTotal,
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
  const routingPass = source.reduce((total, metric) => total + metric.routingPass, 0);
  const routingTotal = source.reduce((total, metric) => total + metric.routingTotal, 0);
  const formatPass = source.reduce((total, metric) => total + metric.formatPass, 0);
  const formatTotal = source.reduce((total, metric) => total + metric.formatTotal, 0);
  const anyPass = source.reduce((total, metric) => total + metric.anyPass, 0);
  const taskPrompts = source.reduce((total, metric) => total + metric.taskPrompts, 0);
  return {
    version, cells, output_tokens_mean: mean(tokenTotal, cells, 1), cost_usd_total: rounded(costTotal, 2),
    wall_clock_mean_s: mean(wallTotal / 1000, cells, 2), hook_files_mean: mean(hookTotal, hookCells, 1),
    statuses: sumStatuses(lanes), task_at_k_pct: roundedPercent(anyPass, taskPrompts),
    format_pct: roundedPercent(formatPass, formatTotal), routing_pct: roundedPercent(routingPass, routingTotal),
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
  const allSources = [...laneSources.values()];
  const allCells = allSources.reduce((total, metric) => total + metric.cells, 0);
  const allWall = allSources.reduce((total, metric) => total + metric.wallClockMs, 0);
  const allCost = allSources.reduce((total, metric) => total + metric.costUsd, 0);
  return {
    generated: { golden_set: golden.version, grade_rows: rows.length, versions: config.versions.map((version) => version.id), models: config.models.map((model) => model.id), trials: config.trials, tier_models: config.tier_models ?? {} },
    lanes, tiers, versions, raw_vs_l7,
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
  return matches.map((match, index) => ({
    id: match[1]!, title: match[2]!.trim(),
    bodyHtml: renderMarkdownSubset(markdown.slice(match.index! + match[0].length, matches[index + 1]?.index ?? markdown.length).trim()),
  }));
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
function statusText(statuses: Record<string, number>): string { return Object.entries(statuses).map(([status, count]) => `${status}: ${count}`).join(", ") || "—"; }
function glossary(data: ReportData): string {
  const descriptions: Record<string, string> = {
    routing_pct: "Share of applicable routing checks that passed.", format_pct: "Share of applicable output-format checks that passed.",
    task_prompts: "Prompts this lane was scheduled to run — restricted tiers are absent from the lanes that never ran them, so this is the pass-rate denominator.",
    task_at_k_pct: "Share of scheduled task prompts with at least one passing trial.", task_all_k_pct: "Share of scheduled task prompts whose trials all passed.",
    output_tokens_mean: "Mean generated output tokens per recorded cell.", wall_clock_mean_s: "Mean recorded wall-clock seconds per cell.",
    cost_usd_total: "Recorded total cost in US dollars.", hook_files_mean: "Mean hook-state files written where recorded.",
    cells: "Cells with a readable meta.json record.", statuses: "Histogram of meta.status values.",
  };
  const keys = Object.keys(data.lanes[0] ?? {}).filter((key) => key in descriptions);
  return table(["Data key", "Meaning"], keys.map((key) => [key, descriptions[key]!]), true);
}
async function defectTable(): Promise<string> {
  const file = path("docs", "defects.json");
  if (!(await exists(file))) return "";
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const items = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { defects?: unknown }).defects) ? (parsed as { defects: unknown[] }).defects : []);
  const records = items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
  if (!records.length) return "";
  const fields = [...new Set(records.flatMap((item) => Object.keys(item)))];
  return `<h3>Recorded defects</h3>${table(fields, records.map((item) => fields.map((field) => typeof item[field] === "object" ? JSON.stringify(item[field]) : item[field])), true)}`;
}

export async function renderReportPage(data: ReportData, sections: ReportSection[]): Promise<string> {
  const matrix = table(["Version", ...data.generated.models], data.generated.versions.map((version) => [version, ...data.generated.models.map((model) => data.lanes.some((lane) => lane.version === version && lane.model === model) ? "run" : "—")]));
  const trials = table(["Tier", "Trials", "Models"], Object.entries(data.generated.trials).map(([tier, trial]) => [tier, trial, data.generated.tier_models[tier]?.join(", ") ?? "all lane models"]));
  const runTiles = `<div class="tiles"><div><b>${data.run.cells_total}</b><span>recorded cells</span></div><div><b>${data.run.statuses.success ?? 0}</b><span>successful cells</span></div><div><b>$${data.run.cost_usd_total}</b><span>recorded cost</span></div><div><b>${data.run.wall_clock_total_h} h</b><span>recorded wall-clock</span></div></div>`;
  const versionRuns = table(["Version", "Cells", "Statuses"], data.versions.map((version) => [version.version, version.cells, statusText(version.statuses)]));
  const modelLabels = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
  const grouped = groupedBarChart("Task pass@k by version and model", modelLabels, data.generated.versions.map((version) => ({ label: version, values: modelLabels.map((model) => data.lanes.find((lane) => lane.version === version && lane.model === model)?.task_at_k_pct ?? null) })));
  const deltas = divergingBarChart("L7 minus RAW task pass@k", data.raw_vs_l7.map((row) => ({ label: row.model, value: row.delta_at_k })));
  // Grouped by model rather than one bar per lane: twenty labels on a single axis shrink to
  // an unreadable smear once the SVG is scaled to the page width.
  const format = groupedBarChart("Format compliance by version and model", modelLabels, data.generated.versions.map((version) => ({ label: version, values: modelLabels.map((model) => data.lanes.find((lane) => lane.version === version && lane.model === model)?.format_pct ?? null) })));
  const routing = groupedBarChart("Algorithm read before substantial work, by version and model", modelLabels, data.generated.versions.map((version) => ({ label: version, values: modelLabels.map((model) => data.lanes.find((lane) => lane.version === version && lane.model === model)?.routing_pct ?? null) })));
  const tokens = simpleBarChart("Mean output tokens per cell, by version", data.versions.map((version) => ({ label: version.version, value: version.output_tokens_mean })));
  const hooks = simpleBarChart("Mean hook-state files written per cell, by version", data.versions.map((version) => ({ label: version.version, value: version.hook_files_mean })));
  const judgeScores = simpleBarChart("Judge score distribution (1–5)", Object.entries(data.judge.score_histogram).map(([score, count]) => ({ label: score, value: count })));
  const laneHeaders = ["Version", "Model", "Prompts", "Routing %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"];
  const laneTable = table(laneHeaders, data.lanes.map((lane) => [lane.version, lane.model, lane.task_prompts, lane.routing_pct, lane.format_pct, lane.task_at_k_pct, lane.task_all_k_pct, lane.cells, lane.output_tokens_mean, lane.wall_clock_mean_s, lane.cost_usd_total, lane.hook_files_mean, statusText(lane.statuses)]));
  const tierTable = table(["Version", "Model", "Tier", "Prompts", "Routing %", "Format %", "Task @k %", "Task all-k %", "Cells", "Tokens mean", "Wall s mean", "Cost USD", "Hook files mean", "Statuses"], data.tiers.map((tier) => [tier.version, tier.model, tier.tier, tier.task_prompts, tier.routing_pct, tier.format_pct, tier.task_at_k_pct, tier.task_all_k_pct, tier.cells, tier.output_tokens_mean, tier.wall_clock_mean_s, tier.cost_usd_total, tier.hook_files_mean, statusText(tier.statuses)]));
  const defects = await defectTable();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>lifeos-bench — scaffolding benchmark report</title><style>
:root { --bg:#f6f7fb; --surface:#ffffff; --text:#172033; --muted:#536076; --border:#cbd3e1; --accent:#315bb8; --accent-soft:#e6edff; --series-1:#315bb8; --series-2:#c1504d; --series-3:#43865b; --series-4:#9b6a19; --grid:#d9dfeb; --shadow:0 0.25rem 1rem rgb(23 32 51 / 8%); }
@media (prefers-color-scheme: dark) { :root { --bg:#111724; --surface:#1b2434; --text:#edf2fc; --muted:#b4c0d4; --border:#3a4961; --accent:#9ab9ff; --accent-soft:#21365f; --series-1:#9ab9ff; --series-2:#ffaaa3; --series-3:#8cd4a1; --series-4:#f0c56e; --grid:#3a4961; --shadow:0 0.25rem 1rem rgb(0 0 0 / 25%); } }
* { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--text); font:1rem/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overflow-x:hidden; } main { width:min(100% - 2rem, 78rem); margin:0 auto; } header { padding:3rem 0 1.5rem; } h1 { margin:0; font-size:clamp(1.8rem,5vw,3.2rem); line-height:1.1; } h2 { margin-top:0; } h3 { margin-top:1.5rem; } section { margin:1.25rem 0; padding:clamp(1rem,3vw,2rem); background:var(--surface); border:1px solid var(--border); border-radius:.75rem; box-shadow:var(--shadow); } .narrative { max-width:74ch; } .table-wrap { max-width:100%; overflow-x:auto; margin:1rem 0; } table { width:100%; border-collapse:collapse; font-size:.9rem; } th,td { padding:.55rem .65rem; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; white-space:nowrap; } .prose th,.prose td { white-space:normal; } .prose td:last-child { min-width:22rem; } th { color:var(--muted); } .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.75rem; margin:1rem 0; } .tiles div { padding:1rem; border-radius:.5rem; background:var(--accent-soft); } .tiles b,.tiles span { display:block; } .tiles b { font-size:1.45rem; } .tiles span { color:var(--muted); font-size:.85rem; } svg { display:block; max-width:100%; margin:1rem 0 2rem; color:var(--muted); } .chart-grid line { stroke:var(--grid); stroke-width:1; } .chart-axis { stroke:var(--muted); stroke-width:1; } svg text { fill:var(--muted); font:11px system-ui,sans-serif; } svg .chart-value { fill:var(--text); font-size:10px; } svg .chart-label { font-size:10px; } a { color:var(--accent); } code { padding:.1em .25em; background:var(--accent-soft); border-radius:.2em; } blockquote { border-left:.25rem solid var(--accent); margin-left:0; padding-left:1rem; color:var(--muted); } footer { color:var(--muted); padding:1rem 0 3rem; font-size:.85rem; } @media (max-width:38rem) { main { width:min(100% - 1rem,78rem); } section { border-radius:.5rem; } svg { margin-left:0; } }
</style></head><body><main><header><h1>Scaffolding benchmark report</h1><p>Frozen golden set ${escapeHtml(data.generated.golden_set)} · aggregate results only</p></header>
<section id="question">${narrative(sections, "question")}</section>
<section id="method">${narrative(sections, "method")}<h3>Configured lane matrix</h3>${matrix}<h3>Trials by tier</h3>${trials}</section>
<section id="run">${narrative(sections, "run")}${runTiles}<h3>Recorded cells by version</h3>${versionRuns}</section>
<section id="findings">${narrative(sections, "findings")}${grouped}${deltas}${format}${routing}${tokens}${hooks}${judgeScores}</section>
<section id="reading">${narrative(sections, "reading")}<h3>Metric glossary</h3>${glossary(data)}</section>
${defects ? `<section id="corrections">${narrative(sections, "corrections")}${defects}</section>` : `<section id="corrections">${narrative(sections, "corrections")}</section>`}
<section id="limitations">${narrative(sections, "limitations")}</section>
<section id="appendix">${narrative(sections, "appendix")}<h3>All lanes</h3>${laneTable}<h3>All scheduled tiers</h3>${tierTable}</section>
<footer>Generated from the shared aggregate metric layer. No individual transcripts or workspaces are included.</footer></main></body></html>\n`;
  // Narrative and defect notes are human-authored, so an operator path can reach the page through
  // prose. Fail loudly rather than redacting: a silent scrub turns a containment breach into a
  // cosmetic edit, and the whole point of the gate is that a breach is visible.
  if (/\/Users\//.test(html)) throw new Error("report page contains an operator path — fix the source, not the output");
  return html;
}

async function main(): Promise<void> {
  const data = await buildReportData();
  const docs = path("docs");
  await ensure(docs);
  const sections = await loadSections(join(docs, "report-sections.md"));
  const page = await renderReportPage(data, sections);
  await writeFile(join(docs, "report-data.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  await writeFile(join(docs, "report.html"), page, "utf8");
  console.log(JSON.stringify({ data: "docs/report-data.json", page: "docs/report.html", bytes: Buffer.byteLength(page) }));
}

if (import.meta.main) await main();
