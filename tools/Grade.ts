import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { arg, ensure, exists, json, path, text } from "./Common.ts";

export type GradeStatus = "pass" | "fail" | "skipped" | "pending_judge";
export type GradeRow = {
  version: string;
  model: string;
  prompt_id: string;
  trial: number;
  grader: string;
  status: GradeStatus;
  detail: string;
};

type Expectation = Record<string, unknown> & { grader: string; name?: string };
export type TrialMeta = {
  final_message?: string;
  token_usage?: Record<string, unknown>;
  baseline?: Record<string, string>;
  changed_files?: string[];
  fixture?: string | null;
};
export type GradeContext = {
  version: string;
  workspace: string;
  transcript: string;
  meta: TrialMeta;
  config: { versions?: Array<{ id: string; routing_markers?: Record<string, string | null> }> };
};

type CommandResult = { stdout: string; stderr: string; code: number; timedOut: boolean };
type TranscriptToolUse = { name?: string; input?: unknown; raw: unknown };

const EDIT_TOOLS = new Set(["write", "edit", "notebookedit"]);
const commandTimeoutMs = 60_000;

function outcome(status: GradeStatus, detail: string): { status: GradeStatus; detail: string } {
  return { status, detail };
}

export { compile as compileForTest };
function compile(pattern: unknown): RegExp {
  if (typeof pattern !== "string") throw new Error("pattern must be a string");
  // JS RegExp rejects PCRE inline flags like (?i)… — translate a leading flag group to
  // real flags instead of letting the grader die (which previously read as a task fail).
  const inline = pattern.match(/^\(\?([ims]+)\)/);
  if (inline) return new RegExp(pattern.slice(inline[0].length), inline[1]);
  return new RegExp(pattern);
}

function matches(value: string, pattern: unknown): boolean {
  return compile(pattern).test(value);
}

function numeric(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  return value;
}

async function runCommand(command: string, cwd: string): Promise<CommandResult> {
  const proc = Bun.spawn(["bash", "-lc", command], { cwd, stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, commandTimeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      stdout: stdout.replace(/\r/g, "").trimEnd(),
      stderr: stderr.replace(/\r/g, "").trimEnd(),
      code,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

function collectToolUses(value: unknown, output: TranscriptToolUse[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectToolUses(item, output);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "tool_use") output.push({
    name: typeof record.name === "string" ? record.name : undefined,
    input: record.input,
    raw: record,
  });
  for (const child of Object.values(record)) collectToolUses(child, output);
}

function transcriptToolUses(transcript: string): TranscriptToolUse[] {
  const calls: TranscriptToolUse[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      collectToolUses(JSON.parse(line), calls);
    } catch {
      // Malformed transcript lines are retained as evidence, but cannot describe a tool call.
    }
  }
  return calls;
}

async function matchingGlobExists(workspace: string, patterns: unknown): Promise<boolean> {
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === "string")) {
    throw new Error("patterns must be an array of strings");
  }
  for (const pattern of patterns) {
    for await (const _file of new Bun.Glob(pattern).scan({ cwd: workspace, onlyFiles: true })) return true;
  }
  return false;
}

async function expectedFixtureText(context: GradeContext, fixtureFile: string): Promise<string> {
  // The fixture source is immutable benchmark input. Prefer it so a run cannot pass by editing
  // expected_output.txt in its own workspace; use the workspace only for synthetic unit contexts.
  if (typeof context.meta.fixture === "string" && context.meta.fixture) {
    const source = path("fixtures", context.meta.fixture, fixtureFile);
    if (await exists(source)) return text(source);
  }
  return text(join(context.workspace, fixtureFile));
}

async function unchanged(context: GradeContext, relativeFile: string): Promise<boolean | undefined> {
  if (Array.isArray(context.meta.changed_files)) return !context.meta.changed_files.includes(relativeFile);
  const originalHash = context.meta.baseline?.[relativeFile];
  if (originalHash === undefined) return undefined;
  const candidate = join(context.workspace, relativeFile);
  if (!(await exists(candidate))) return false;
  return Bun.hash(await readFile(candidate)).toString(16) === originalHash;
}

function outputTokenCount(usage: Record<string, unknown> | undefined): number {
  if (!usage) return 0;
  for (const key of ["output_tokens", "output", "completion_tokens"]) {
    const candidate = usage[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return 0;
}

export async function gradeExpectation(expectation: Expectation, context: GradeContext): Promise<{ status: GradeStatus; detail: string }> {
  try {
    const fail = (detail: string) => outcome("fail", detail);
    const pass = (detail: string) => outcome("pass", detail);
    const type = expectation.grader;
    if (type === "judge:rubric") return outcome("pending_judge", `rubric ${String(expectation.rubric ?? "unnamed")} awaits external judge`);

    const relativeFile = typeof expectation.file === "string" ? expectation.file : undefined;
    const file = relativeFile === undefined ? undefined : join(context.workspace, relativeFile);

    if (type === "code:regex") {
      const target = expectation.target === "final_message" ? context.meta.final_message ?? "" : context.transcript;
      return matches(target, expectation.pattern) ? pass("pattern matched") : fail("pattern did not match");
    }

    if (type === "code:file_contains" || type === "code:file_not_contains") {
      if (!file || !relativeFile) return fail("file must be specified");
      if (!(await exists(file))) return fail(`${relativeFile} missing`);
      const value = await text(file);
      const found = matches(value, expectation.pattern);
      const wanted = type === "code:file_contains" ? found : !found;
      return wanted ? pass(`${relativeFile} condition met`) : fail(`${relativeFile} condition not met`);
    }

    if (type === "code:file_exists") {
      if (!file || !relativeFile) return fail("file must be specified");
      return await exists(file) ? pass(`${relativeFile} exists`) : fail(`${relativeFile} missing`);
    }

    if (type === "code:file_exists_any") {
      return await matchingGlobExists(context.workspace, expectation.patterns) ? pass("matching file exists") : fail("no matching file exists");
    }

    if (type === "code:file_unchanged") {
      if (!relativeFile) return fail("file must be specified");
      const isUnchanged = await unchanged(context, relativeFile);
      if (isUnchanged === undefined) return fail(`no baseline available for ${relativeFile}`);
      return isUnchanged ? pass(`${relativeFile} unchanged`) : fail(`${relativeFile} changed`);
    }

    if (type === "code:workspace_diff_count") {
      if (!Array.isArray(context.meta.changed_files)) return fail("changed-files metadata is unavailable");
      const maximum = numeric(expectation.max_changed_files, "max_changed_files");
      const count = context.meta.changed_files.length;
      return count <= maximum ? pass(`${count} changed files`) : fail(`${count} changed files exceeds ${maximum}`);
    }

    if (type === "code:max_tool_calls") {
      const maximum = numeric(expectation.max, "max");
      const count = transcriptToolUses(context.transcript).length;
      return count <= maximum ? pass(`${count} tool calls`) : fail(`${count} tool calls exceeds ${maximum}`);
    }

    if (type === "code:token_budget") {
      const maximum = numeric(expectation.max_output_tokens, "max_output_tokens");
      const count = outputTokenCount(context.meta.token_usage);
      return count <= maximum ? pass(`${count} output tokens`) : fail(`${count} output tokens exceeds ${maximum}`);
    }

    if (type === "code:command_exit0" || type === "code:command_output" || type === "code:command_output_matches_fixture") {
      if (typeof expectation.command !== "string" || !expectation.command) return fail("command must be specified");
      const result = await runCommand(expectation.command, context.workspace);
      if (type === "code:command_exit0") {
        if (result.timedOut) return fail("command timed out");
        return result.code === 0 ? pass("command exited 0") : fail(`command exited ${result.code}: ${result.stderr}`);
      }
      const expected = type === "code:command_output"
        ? typeof expectation.expect_stdout === "string" ? expectation.expect_stdout : String(expectation.expect_stdout ?? "")
        : await expectedFixtureText(context, String(expectation.fixture_file ?? ""));
      if (result.timedOut) return fail("command timed out");
      return result.code === 0 && result.stdout === expected.replace(/\r/g, "").trimEnd()
        ? pass("command output matched")
        : fail(`expected ${JSON.stringify(expected.replace(/\r/g, "").trimEnd())}, got ${JSON.stringify(result.stdout)} (exit ${result.code})`);
    }

    if (type === "code:transcript_contains_command") {
      const calls = transcriptToolUses(context.transcript);
      const matchingCall = calls.findIndex((call) => matches(JSON.stringify(call.raw), expectation.pattern));
      if (matchingCall < 0) return fail("command not found in a tool call");
      if (expectation.before_first_edit === true) {
        const firstEdit = calls.findIndex((call) => call.name !== undefined && EDIT_TOOLS.has(call.name.toLowerCase()));
        if (firstEdit >= 0 && matchingCall > firstEdit) return fail("command occurred after the first edit");
      }
      return pass("command found in required order");
    }

    if (type === "code:routing") {
      // GPT lanes retain the source scaffold's routing contract while using a distinct
      // result namespace, so L7-GPT resolves L7's markers without changing base lanes.
      const routingVersion = context.version.endsWith("-GPT") ? context.version.slice(0, -4) : context.version;
      const markers = context.config.versions?.find((version) => version.id === routingVersion)?.routing_markers;
      const mode = typeof expectation.expect_mode === "string" ? expectation.expect_mode : "";
      const marker = markers?.[mode];
      if (marker === null || marker === undefined) return outcome("skipped", "routing markers unavailable for this version");
      return matches(context.transcript, marker) ? pass(`matched ${mode} routing marker`) : fail(`missing ${mode} routing marker`);
    }

    return fail(`unsupported grader ${type}`);
  } catch (error) {
    // A broken grader must be loud, never a silent task "fail" — a grader bug otherwise
    // reads as a model failure and poisons the benchmark numbers.
    return outcome("grader_error" as GradeStatus, `grader configuration or execution error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function gradeTrial(version: string, model: string, promptId: string, trial: number): Promise<GradeRow[]> {
  const config = await json<GradeContext["config"]>(path("bench.config.json"));
  const golden = await json<{ prompts: Array<{ id: string; expectations: Expectation[] }> }>(path("goldenset", "goldenset.json"));
  const prompt = golden.prompts.find((candidate) => candidate.id === promptId);
  if (!prompt) throw new Error(`unknown prompt ${promptId}`);

  const trialDirectory = path("results", "phase1", version, model, promptId, `trial-${trial}`);
  const meta = await json<TrialMeta>(join(trialDirectory, "meta.json"));
  const workspace = join(trialDirectory, "workspace");
  const transcript = await text(join(trialDirectory, "transcript.jsonl"));
  const rows: GradeRow[] = [];

  for (const expectation of prompt.expectations) {
    const result = await gradeExpectation(expectation, { version, workspace, transcript, meta, config });
    rows.push({ version, model, prompt_id: promptId, trial, grader: expectation.name ?? expectation.grader, ...result });
  }

  const output = path("results", "phase1", "grades.jsonl");
  await ensure(join(output, ".."));
  await appendFile(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return rows;
}

if (import.meta.main) {
  const version = arg("--version");
  const model = arg("--model");
  const prompt = arg("--prompt");
  const trial = Number(arg("--trial"));
  if (!version || !model || !prompt || !Number.isInteger(trial) || trial < 1) {
    throw new Error("usage: bun tools/Grade.ts --version V --model M --prompt ID --trial N");
  }
  console.log(JSON.stringify(await gradeTrial(version, model, prompt, trial)));
}
