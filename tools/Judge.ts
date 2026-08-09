import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arg, ensure, exists, json, path } from "./Common.ts";

type GradeRow = {
  version: string;
  model: string;
  prompt_id: string;
  trial: number;
  grader: string;
  status: string;
};
type Rubric = { inputs: string[]; criteria: string[]; score_anchor: string };
type RubricsFile = { rubrics: Record<string, Rubric> };
type Expectation = { grader: string; rubric?: string; min_score?: number; name?: string };
type Prompt = { id: string; tier?: string; prompt: string; expectations: Expectation[] };
type GoldenSet = { prompts: Prompt[] };
type TrialMeta = { final_message?: string };

type PendingJudgment = {
  source: GradeRow;
  rubricName: string;
  rubric: Rubric;
  minScore: number;
  prompt: string;
  finalMessage: string;
  workspaceDiff?: string;
  /** Synthetic persona materials, supplied only for tiers whose rubric grades grounding. */
  persona?: string;
};

export type JudgeReply = { score: number; reasoning: string; criteria_met: string[] };
type JudgeResult = { reply: JudgeReply | null; error: string | null; attempts: number };

// 300s: diff-bearing rubrics (t3-debug) legitimately take >120s — a shorter timeout
// killed the judge mid-reply and surfaced as "no valid JSON" (reproducible, not transient).
const JUDGE_TIMEOUT_MS = 300_000;
const BLINDING_MARKERS = /♻|═══|\bPAI\b|\bALGORITHM\b|\bNATIVE MODE\b|\bMINIMAL\b|🗣️|LifeOS/i;

function key(row: Pick<GradeRow, "version" | "model" | "prompt_id" | "trial" | "grader">): string {
  return [row.version, row.model, row.prompt_id, row.trial, row.grader].join("|");
}

function latestRows(rows: GradeRow[]): GradeRow[] {
  const latest = new Map<string, GradeRow>();
  for (const row of rows) latest.set(key(row), row);
  return [...latest.values()];
}

async function readJsonLines(file: string): Promise<GradeRow[]> {
  if (!(await exists(file))) return [];
  const content = await readFile(file, "utf8");
  const rows: GradeRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<GradeRow>;
      if (typeof row.version === "string" && typeof row.model === "string" && typeof row.prompt_id === "string" &&
          Number.isInteger(row.trial) && typeof row.grader === "string" && typeof row.status === "string") {
        rows.push(row as GradeRow);
      }
    } catch {
      // A partially written JSONL line is not a completed grade and is ignored.
    }
  }
  return rows;
}

/** Remove framework-identifying banner lines while leaving substantive response text intact. */
export function scrubResponse(response: string): string {
  return response.split(/\r?\n/).filter((line) => !BLINDING_MARKERS.test(line)).join("\n");
}

function isJudgeReply(value: unknown): value is JudgeReply {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.score) && (record.score as number) >= 1 && (record.score as number) <= 5 &&
    typeof record.reasoning === "string" && Array.isArray(record.criteria_met) &&
    record.criteria_met.every((criterion) => typeof criterion === "string");
}

/**
 * Parse the final complete JSON object in output as the strict judge reply.
 * A scanner is used instead of line parsing because judge reasoning can contain newlines.
 */
export function extractLastJudgeReply(output: string): JudgeReply | null {
  const candidates: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < output.length; index++) {
    const character = output[index];
    if (start < 0) {
      if (character === "{") { start = index; depth = 1; quoted = false; escaped = false; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === "{") { depth++; continue; }
    if (character === "}") {
      depth--;
      if (depth === 0) {
        try { candidates.push(JSON.parse(output.slice(start, index + 1))); } catch { /* not valid JSON */ }
        start = -1;
      }
    }
  }

  const last = candidates.at(-1);
  return isJudgeReply(last) ? last : null;
}

/**
 * The judge emits its verdict as one JSON line, but the surrounding transcript can carry
 * unbalanced braces (code fences, diff hunks) that desync a depth-scanning parser. Scan
 * whole lines from the end first; fall back to the depth scanner for wrapped output.
 */
export function extractJudgeReply(output: string): JudgeReply | null {
  const lines = output.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line);
      if (isJudgeReply(parsed)) return parsed;
    } catch { /* transcript noise */ }
  }
  return extractLastJudgeReply(output);
}

/** Execute at most twice, retrying a malformed response (or command failure) once. */
export async function judgeWithRetry(invoke: () => Promise<string>): Promise<JudgeResult> {
  let lastError: string | null = null;
  for (let attempts = 1; attempts <= 2; attempts++) {
    try {
      const output = await invoke();
      const reply = extractJudgeReply(output);
      if (reply) return { reply, error: null, attempts };
      lastError = "judge returned no valid JSON reply";
      if (Bun.env.JUDGE_DEBUG_DIR) {
        await writeFile(join(Bun.env.JUDGE_DEBUG_DIR, `judge-fail-${Date.now()}.txt`), output);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { reply: null, error: lastError ?? "judge failed without an error message", attempts: 2 };
}

/**
 * The synthetic persona, assembled from the same blocks StagePersona renders into each install.
 * Cached because every T5 judgment needs the identical text.
 */
let personaCache: string | undefined;
export async function personaMaterials(): Promise<string> {
  if (personaCache !== undefined) return personaCache;
  const blocks = ["principal", "telos", "projects", "da", "operational_rules"];
  const parts: string[] = [];
  for (const block of blocks) {
    const file = path("fixtures", "_persona", "blocks", `${block}.md`);
    if (await exists(file)) parts.push((await readFile(file, "utf8")).trim());
  }
  if (parts.length === 0) throw new Error("persona blocks are missing; T5 grounding cannot be judged");
  personaCache = parts.join("\n\n---\n\n");
  return personaCache;
}

function buildPrompt(judgment: PendingJudgment): string {
  const materials = [
    "## User prompt",
    judgment.prompt,
    "",
    "## Final response (blinded and scrubbed)",
    scrubResponse(judgment.finalMessage),
  ];
  // Personalization rubrics ask whether the response cites the user's ACTUAL profile. Without
  // the profile in front of it, the judge cannot tell a correct citation from a fabricated one
  // and simply guesses — which is what happened: two cells citing the identical (real) fact got
  // opposite verdicts, one passed as grounded, one failed as "unverifiable assertion". Supplying
  // the persona is what makes the T5 tier measurable at all.
  if (judgment.persona !== undefined) {
    materials.push("", "## The user's profile (ground truth for grounding checks)", judgment.persona);
  }
  if (judgment.workspaceDiff !== undefined) materials.push("", "## Workspace diff", judgment.workspaceDiff);
  return [
    "You are an independent benchmark judge. Score the response only against this rubric and supplied materials.",
    "Do not infer or discuss the model, framework, or scaffolding; they are intentionally withheld.",
    "Return STRICT JSON only, with no Markdown or extra text:",
    '{"score": 1-5, "reasoning": "...", "criteria_met": ["..."]}',
    "",
    "## Rubric criteria",
    ...judgment.rubric.criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    "",
    "## Score anchors",
    judgment.rubric.score_anchor,
    "",
    ...materials,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function runJudge(commandTemplate: string, promptFile: string): Promise<string> {
  if (!commandTemplate.includes("{promptfile}")) throw new Error("JUDGE_CMD must contain {promptfile}");
  const command = commandTemplate.replaceAll("{promptfile}", shellQuote(promptFile));
  const process = Bun.spawn(["bash", "-lc", command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; process.kill("SIGTERM"); }, JUDGE_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (timedOut) throw new Error(`judge timed out after ${JUDGE_TIMEOUT_MS / 1000}s`);
    if (exitCode !== 0) throw new Error(`judge exited ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

function expectationFor(row: GradeRow, prompt: Prompt): Expectation | undefined {
  const judgeExpectations = prompt.expectations.filter((expectation) => expectation.grader === "judge:rubric");
  return judgeExpectations.find((expectation) => (expectation.name ?? expectation.grader) === row.grader) ??
    (judgeExpectations.length === 1 ? judgeExpectations[0] : undefined);
}

async function pendingJudgments(limit?: number): Promise<PendingJudgment[]> {
  const grades = latestRows(await readJsonLines(path("results", "phase1", "grades.jsonl")));
  const alreadyJudged = new Set((await readJsonLines(path("results", "phase1", "judge-grades.jsonl"))).map(key));
  const golden = await json<GoldenSet>(path("goldenset", "goldenset.json"));
  const rubrics = await json<RubricsFile>(path("goldenset", "rubrics.json"));
  const pending = grades.filter((row) => row.status === "pending_judge" && !alreadyJudged.has(key(row)));
  const selected = limit === undefined ? pending : pending.slice(0, limit);
  const judgments: PendingJudgment[] = [];

  for (const source of selected) {
    const prompt = golden.prompts.find((candidate) => candidate.id === source.prompt_id);
    if (!prompt) throw new Error(`pending grade references unknown prompt ${source.prompt_id}`);
    const expectation = expectationFor(source, prompt);
    if (!expectation?.rubric) throw new Error(`pending grade ${source.grader} has no matching judge rubric`);
    const rubric = rubrics.rubrics[expectation.rubric];
    if (!rubric) throw new Error(`unknown rubric ${expectation.rubric}`);
    if (!Number.isInteger(expectation.min_score) || expectation.min_score < 1 || expectation.min_score > 5) {
      throw new Error(`rubric ${expectation.rubric} has an invalid min_score`);
    }
    const trialDirectory = path("results", "phase1", source.version, source.model, source.prompt_id, `trial-${source.trial}`);
    // A missing meta.json means the fleet is mid-rerun of this trial (RunCell wipes the
    // trial dir first) — skip it; the re-run emits a fresh pending_judge row to pick up.
    if (!(await exists(join(trialDirectory, "meta.json")))) continue;
    const meta = await json<TrialMeta>(join(trialDirectory, "meta.json"));
    if (typeof meta.final_message !== "string") throw new Error(`trial ${source.prompt_id}/trial-${source.trial} has no final_message`);
    // Build-tier cells produce multi-MB diffs (lockfiles, caches) that overflow ARG_MAX
    // downstream (E2BIG). 40KB is plenty for rubric judging; mark the cut honestly.
    const DIFF_CAP = 40_000;
    let workspaceDiff = rubric.inputs.includes("workspace_diff")
      ? await readFile(join(trialDirectory, "workspace-diff.txt"), "utf8")
      : undefined;
    if (workspaceDiff !== undefined && workspaceDiff.length > DIFF_CAP) {
      workspaceDiff = `${workspaceDiff.slice(0, DIFF_CAP)}\n\n[diff truncated at ${DIFF_CAP} bytes of ${workspaceDiff.length}]`;
    }
    judgments.push({ source, rubricName: expectation.rubric, rubric, minScore: expectation.min_score, prompt: prompt.prompt, finalMessage: meta.final_message, workspaceDiff, persona: prompt.tier === "T5" ? await personaMaterials() : undefined });
  }
  return judgments;
}

function parseLimit(): number | undefined {
  const value = arg("--limit");
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0) throw new Error("--limit must be a non-negative integer");
  return limit;
}

/**
 * Restrict a judging pass to one model's cells.
 *
 * Judges must be cross-vendor: a Claude-family cell is judged by GPT and a GPT-family cell by
 * Claude, so no vendor grades its own output. JUDGE_CMD is a single template, so honouring that
 * requires running one pass per vendor with a different command — which needs this filter.
 * Without it the only options were "one judge for everything" (same-vendor for half the matrix)
 * or nothing.
 */
export function selectByModel<T extends { source: { model: string } }>(judgments: T[], model: string | undefined): T[] {
  if (model === undefined) return judgments;
  const wanted = new Set(model.split(",").map((entry) => entry.trim()).filter(Boolean));
  if (wanted.size === 0) throw new Error("--model requires at least one model id");
  return judgments.filter((judgment) => wanted.has(judgment.source.model));
}

async function appendResult(judgment: PendingJudgment, result: JudgeResult): Promise<void> {
  const row = {
    version: judgment.source.version,
    model: judgment.source.model,
    prompt_id: judgment.source.prompt_id,
    trial: judgment.source.trial,
    grader: judgment.source.grader,
    rubric: judgment.rubricName,
    score: result.reply?.score ?? null,
    min_score: judgment.minScore,
    status: result.reply ? (result.reply.score >= judgment.minScore ? "pass" : "fail") : "judge_error",
    reasoning: result.reply?.reasoning ?? `Judge error after ${result.attempts} attempts: ${result.error}`,
  };
  const output = path("results", "phase1", "judge-grades.jsonl");
  await ensure(join(output, ".."));
  await appendFile(output, `${JSON.stringify(row)}\n`);
}

async function main(): Promise<void> {
  const dryRun = Bun.argv.includes("--dry-run");
  const judgments = selectByModel(await pendingJudgments(parseLimit()), arg("--model"));
  if (dryRun) {
    console.log(`Pending judge rows: ${judgments.length}`);
    if (judgments[0]) console.log(buildPrompt(judgments[0]));
    return;
  }

  const commandTemplate = Bun.env.JUDGE_CMD;
  if (!commandTemplate) throw new Error("JUDGE_CMD is required unless --dry-run is used");
  for (const judgment of judgments) {
    const tempDirectory = await mkdtemp(join(tmpdir(), "lifeos-bench-judge-"));
    try {
      const promptFile = join(tempDirectory, "prompt.txt");
      await writeFile(promptFile, buildPrompt(judgment), "utf8");
      const result = await judgeWithRetry(() => runJudge(commandTemplate, promptFile));
      await appendResult(judgment, result);
      console.log(JSON.stringify({ prompt_id: judgment.source.prompt_id, trial: judgment.source.trial, grader: judgment.source.grader, status: result.reply ? (result.reply.score >= judgment.minScore ? "pass" : "fail") : "judge_error" }));
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) await main();
