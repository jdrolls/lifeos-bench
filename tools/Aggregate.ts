import { join } from "node:path";
import { exists, json, path } from "./Common.ts";

/**
 * Shared aggregation for every reporting surface.
 *
 * Report.ts and BuildReportPage.ts both publish the same numbers. When each carried its own
 * copy of the metric definitions they were free to drift, and a reader comparing the Markdown
 * report against the HTML page would have had no way to tell which one was wrong. One
 * implementation, two renderers.
 */

export type Row = {
  version: string;
  model: string;
  prompt_id: string;
  trial: number;
  grader: string;
  status: string;
  detail?: string;
  reasoning?: string;
  score?: number | null;
  min_score?: number;
  rubric?: string;
};

export type Expectation = { grader: string; name?: string; rubric?: string; min_score?: number; expect?: string; expect_mode?: string };
export type Prompt = { id: string; tier: string; prompt?: string; expectations: Expectation[] };
export type GoldenSet = { version: string; prompts: Prompt[] };
export type VersionConfig = { id: string; models_allowlist?: string[] | null; [key: string]: unknown };
export type ModelConfig = { id: string; cli_arg: string; engine?: string };
export type BenchConfig = {
  versions: VersionConfig[];
  models: ModelConfig[];
  trials: Record<string, number>;
  tier_models?: Record<string, string[]>;
};

export type CellFacts = {
  status: string;
  outputTokens: number;
  wallClockMs: number;
  costUsd: number;
  hookFilesWritten: number | null;
};

export type LaneMetrics = {
  /** `code:routing` only — the version's own mode/banner markers. Null for versions with none. */
  routingPass: number;
  routingTotal: number;
  /** Did the scaffold read its Algorithm before HEAVY work (build, cross-module debug, hidden scope)? */
  algorithmEntryPass: number;
  algorithmEntryTotal: number;
  /** Did it correctly NOT read it for trivial work? Every version passes these; kept separate for that reason. */
  algorithmSkipPass: number;
  algorithmSkipTotal: number;
  formatPass: number;
  formatTotal: number;
  /** Prompts passing on at least one trial (pass@k) and on every trial (pass^k). */
  anyPass: number;
  allPass: number;
  taskPrompts: number;
  cells: number;
  outputTokens: number;
  wallClockMs: number;
  costUsd: number;
  hookFilesWritten: number;
  hookCells: number;
  statuses: Record<string, number>;
};

function key(row: Pick<Row, "version" | "model" | "prompt_id" | "trial" | "grader">): string {
  return [row.version, row.model, row.prompt_id, row.trial, row.grader].join("|");
}

/** Later rows for the same grader supersede earlier ones — a re-grade is not a second opinion. */
export function latestRows(...sources: string[]): Row[] {
  const latest = new Map<string, Row>();
  for (const source of sources) {
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Row;
        if (typeof row.version !== "string" || typeof row.grader !== "string") continue;
        latest.set(key(row), row);
      } catch {
        // A partially written JSONL line is not a completed grade.
      }
    }
  }
  return [...latest.values()];
}

/**
 * Grader buckets, identified by TYPE and by the golden set's own `expect` field — never by name
 * prefix, because T4's trap graders have descriptive names and must still be classified.
 *
 * FOUR buckets, not two. `code:algorithm_read` asks opposite questions on opposite prompts:
 * on heavy work it asks whether the Algorithm was ENTERED, and on trivial work whether it was
 * correctly SKIPPED. Every version passes the skip checks — nothing reads an Algorithm to
 * answer "thanks, that's all for now" — so averaging the two together dilutes the entry rate
 * toward the skip rate and hides the single largest effect in this benchmark. That is the same
 * conflation mistake that produced the retracted v7 headline, one level down.
 */
export function graderKinds(golden: GoldenSet): {
  routing: Set<string>; format: Set<string>; algorithmEntry: Set<string>; algorithmSkip: Set<string>;
} {
  const routing = new Set<string>();
  const format = new Set<string>();
  const algorithmEntry = new Set<string>();
  const algorithmSkip = new Set<string>();
  for (const prompt of golden.prompts) {
    for (const expectation of prompt.expectations) {
      const name = `${prompt.id}|${expectation.name ?? expectation.grader}`;
      if (expectation.grader === "code:routing") routing.add(name);
      if (expectation.grader === "code:algorithm_read") {
        (expectation.expect === "not_read" ? algorithmSkip : algorithmEntry).add(name);
      }
      if (expectation.grader === "code:format_compliance") format.add(name);
    }
  }
  return { routing, format, algorithmEntry, algorithmSkip };
}

/** Prompts carrying at least one graded expectation that is not routing or format. */
export function taskPromptCount(prompts: Prompt[]): number {
  return prompts.filter((prompt) =>
    prompt.expectations.some((expectation) =>
      !["code:routing", "code:algorithm_read", "code:format_compliance"].includes(expectation.grader))).length;
}

export async function readCellFacts(resultsRoot: string, version: string, model: string, promptId: string, trial: number): Promise<CellFacts | null> {
  const metaFile = join(resultsRoot, version, model, promptId, `trial-${trial}`, "meta.json");
  if (!(await exists(metaFile))) return null;
  try {
    const meta = await json<any>(metaFile);
    return {
      status: typeof meta.status === "string" ? meta.status : "unknown",
      outputTokens: Number(meta.token_usage?.output_tokens ?? meta.token_usage?.output ?? 0),
      wallClockMs: Number(meta.wall_clock_ms ?? 0),
      costUsd: Number(meta.total_cost_usd ?? 0),
      hookFilesWritten: typeof meta.hook_state?.files_written === "number" ? meta.hook_state.files_written : null,
    };
  } catch {
    return null;
  }
}

export type LaneOptions = {
  rows: Row[];
  golden: GoldenSet;
  config: BenchConfig;
  version: string;
  model: string;
  tier?: string;
  resultsRoot: string;
};

/**
 * The prompts this lane was actually scheduled to run.
 *
 * `tier_models` restricts a tier to a subset of models — T5 runs on the two bisect models only,
 * because grounding is a property of the scaffold rather than of model tier and paying for it
 * across eight models buys little. Every prompt in a restricted tier is therefore absent from
 * six of the eight model lanes by design.
 *
 * Dividing by the full prompt set regardless is not a rounding error: it graded six of eight
 * lanes on five prompts they were never scheduled to run, counting each as a failure. It cost a
 * restricted lane up to 23.8 points and manufactured a published headline — "no model passes
 * 100% bare" — out of prompts that were never sent.
 */
export function scheduledPrompts(golden: GoldenSet, config: BenchConfig, model: string, tier?: string): Prompt[] {
  return golden.prompts.filter((prompt) =>
    (!tier || prompt.tier === tier) &&
    (!config.tier_models?.[prompt.tier] || config.tier_models[prompt.tier].includes(model)));
}

export async function laneMetrics(options: LaneOptions): Promise<LaneMetrics> {
  const { rows, golden, config, version, model, tier, resultsRoot } = options;
  const kinds = graderKinds(golden);
  const prompts = scheduledPrompts(golden, config, model, tier);
  const metrics: LaneMetrics = {
    routingPass: 0, routingTotal: 0,
    algorithmEntryPass: 0, algorithmEntryTotal: 0, algorithmSkipPass: 0, algorithmSkipTotal: 0,
    formatPass: 0, formatTotal: 0,
    anyPass: 0, allPass: 0, taskPrompts: taskPromptCount(prompts),
    cells: 0, outputTokens: 0, wallClockMs: 0, costUsd: 0,
    hookFilesWritten: 0, hookCells: 0, statuses: {},
  };

  for (const prompt of prompts) {
    const trialCount = config.trials[prompt.tier];
    const passes: boolean[] = [];
    for (let trial = 1; trial <= trialCount; trial++) {
      const trialRows = rows.filter((row) =>
        row.version === version && row.model === model && row.prompt_id === prompt.id && row.trial === trial);

      for (const row of trialRows) {
        const name = `${prompt.id}|${row.grader}`;
        if (row.status === "skipped") continue;
        if (kinds.routing.has(name)) { metrics.routingTotal++; if (row.status === "pass") metrics.routingPass++; }
        if (kinds.algorithmEntry.has(name)) { metrics.algorithmEntryTotal++; if (row.status === "pass") metrics.algorithmEntryPass++; }
        if (kinds.algorithmSkip.has(name)) { metrics.algorithmSkipTotal++; if (row.status === "pass") metrics.algorithmSkipPass++; }
        if (kinds.format.has(name)) { metrics.formatTotal++; if (row.status === "pass") metrics.formatPass++; }
      }

      // A `skipped` task grader means "this check does not apply to this version" — the golden
      // set skips T5 grounding for the control, which structurally cannot know the persona.
      // Counting a skip as a non-pass turned that documented exemption into a failure and
      // penalised only the control. Skips are excluded; a trial with nothing left to judge
      // contributes no verdict at all rather than a false one.
      const task = trialRows.filter((row) => {
        const name = `${prompt.id}|${row.grader}`;
        return !kinds.routing.has(name) && !kinds.format.has(name) &&
          !kinds.algorithmEntry.has(name) && !kinds.algorithmSkip.has(name) &&
          row.status !== "pending_judge" && row.status !== "skipped";
      });
      if (task.length) passes.push(task.every((row) => row.status === "pass"));

      const facts = await readCellFacts(resultsRoot, version, model, prompt.id, trial);
      if (facts) {
        metrics.cells++;
        metrics.outputTokens += facts.outputTokens;
        metrics.wallClockMs += facts.wallClockMs;
        metrics.costUsd += facts.costUsd;
        metrics.statuses[facts.status] = (metrics.statuses[facts.status] ?? 0) + 1;
        if (facts.hookFilesWritten !== null) { metrics.hookFilesWritten += facts.hookFilesWritten; metrics.hookCells++; }
      }
    }
    if (passes.length) {
      if (passes.some(Boolean)) metrics.anyPass++;
      if (passes.length === trialCount && passes.every(Boolean)) metrics.allPass++;
    }
  }
  return metrics;
}

/** Only the lanes the matrix actually runs; a restricted version must not render rows of em-dashes. */
export function lanesFor(config: BenchConfig, version: VersionConfig): ModelConfig[] {
  return config.models.filter((model) => !version.models_allowlist || version.models_allowlist.includes(model.id));
}

export const percent = (numerator: number, denominator: number): string =>
  denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : "—";

export const ratio = (numerator: number, denominator: number): number | null =>
  denominator ? (100 * numerator) / denominator : null;

export async function loadInputs(resultsRoot = path("results", "phase1")): Promise<{
  config: BenchConfig; golden: GoldenSet; rows: Row[]; resultsRoot: string;
}> {
  const config = await json<BenchConfig>(path("bench.config.json"));
  const golden = await json<GoldenSet>(path("goldenset", "goldenset.json"));
  const gradeFile = join(resultsRoot, "grades.jsonl");
  const judgeFile = join(resultsRoot, "judge-grades.jsonl");
  const grades = (await exists(gradeFile)) ? await Bun.file(gradeFile).text() : "";
  const judged = (await exists(judgeFile)) ? await Bun.file(judgeFile).text() : "";
  return { config, golden, rows: latestRows(grades, judged), resultsRoot };
}
