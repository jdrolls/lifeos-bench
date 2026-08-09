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
  config: { versions?: Array<{ id: string; routing_markers?: Record<string, string | null>; algorithm_path?: string | null; format_marker?: string | null }> };
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

/**
 * Scaffold runtime state written into the graded workspace is not the model's work product.
 *
 * A cell runs with cwd = its workspace, so a scaffold's hooks create a project-local `.claude/`
 * and write bookkeeping there (drift reminders, ISA nudges, skill indexes). Counting those as
 * "changed files" is not a small inaccuracy: the diff-count thresholds are 0, 1 and 2, so a
 * single stray file flips a verdict. It failed L7 on `plan_means_stop` for a plan-only prompt it
 * had obeyed perfectly — every "changed file" was hook state.
 *
 * The bias is one-directional and therefore worse than noise: only versions that HAVE hooks can
 * be penalised, never the bare control, so the metric silently rewards the absence of scaffolding
 * — the exact thing this benchmark exists to measure.
 */
export function isScaffoldState(file: unknown): boolean {
  return typeof file === "string" && /(^|\/)\.claude\//.test(file);
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

/**
 * Concatenate only what the model SAID — assistant text blocks — excluding tool results and
 * file contents it merely read.
 *
 * Matching banner markers against the raw transcript is unsound: on substantial prompts the
 * model is expected to READ the Algorithm file, and that file contains banner examples. The
 * routing grader would then pass on text the model never emitted. final_message alone is
 * also wrong, because a mode banner opens the FIRST assistant turn of an agentic run, not
 * the last.
 */
export function assistantText(transcript: string): string {
  const parts: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (event.type !== "assistant") continue;
      const content = event.message?.content;
      if (typeof content === "string") { parts.push(content); continue; }
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
          const text = (block as { text?: unknown }).text;
          if (typeof text === "string") parts.push(text);
        }
      }
    } catch {
      // Malformed lines are evidence, not assistant speech.
    }
  }
  return parts.join("\n");
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

    // Some expectations are unanswerable for a version rather than failed by it: the bare
    // control cannot cite a profile it has no way to read. Scoring that as a failure would
    // load the control's floor with a structural impossibility instead of a measurement.
    const skipOn = expectation.skip_on_versions;
    if (Array.isArray(skipOn) && skipOn.some((version) => version === context.version)) {
      return outcome("skipped", `expectation does not apply to ${context.version}`);
    }
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
      const changed = (context.meta.changed_files as unknown[]).filter((file) => !isScaffoldState(file));
      const count = changed.length;
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

    if (type === "code:format_compliance") {
      // Did the response follow the version's OWN documented output contract? Kept separate
      // from routing: v7.28.3 has a format contract and no modes, so folding the two together
      // is precisely what scored it zero for a feature it removed deliberately.
      const formatVersion = context.version.endsWith("-GPT") ? context.version.slice(0, -4) : context.version;
      const marker = context.config.versions?.find((version) => version.id === formatVersion)?.format_marker;
      if (marker === null || marker === undefined) return outcome("skipped", "version declares no output format");
      const message = context.meta.final_message ?? "";
      return matches(message, marker) ? pass("emitted the version's output banner") : fail("output banner missing");
    }

    if (type === "code:algorithm_read") {
      // Version-neutral routing signal. Banner grepping only works while a version HAS
      // banners: v5/v6 announce three modes, v7.28.3 retired modes outright and announces
      // nothing. What every generation shares is the instruction to READ the Algorithm file
      // before substantial work — a tool call, recorded in every transcript, that means the
      // same thing across versions. Absence of a scaffold (RAW) skips, exactly like routing.
      const algorithmVersion = context.version.endsWith("-GPT") ? context.version.slice(0, -4) : context.version;
      const directory = context.config.versions?.find((version) => version.id === algorithmVersion)?.algorithm_path;
      if (directory === null || directory === undefined) {
        return outcome("skipped", "version declares no algorithm path");
      }
      const reads = transcriptToolUses(context.transcript).filter((call) => {
        if (call.name?.toLowerCase() !== "read") return false;
        const input = call.input as { file_path?: unknown } | undefined;
        return typeof input?.file_path === "string" && input.file_path.includes(directory);
      });
      const shouldRead = expectation.expect !== "not_read";
      if (shouldRead) return reads.length > 0 ? pass(`read the algorithm (${reads.length} call(s))`) : fail("never read the algorithm");
      return reads.length === 0 ? pass("did not read the algorithm") : fail(`read the algorithm ${reads.length} time(s) on a trivial turn`);
    }

    if (type === "code:routing") {
      // GPT lanes retain the source scaffold's routing contract while using a distinct
      // result namespace, so L7-GPT resolves L7's markers without changing base lanes.
      const routingVersion = context.version.endsWith("-GPT") ? context.version.slice(0, -4) : context.version;
      const markers = context.config.versions?.find((version) => version.id === routingVersion)?.routing_markers;
      const mode = typeof expectation.expect_mode === "string" ? expectation.expect_mode : "";
      const marker = markers?.[mode];
      if (marker === null || marker === undefined) return outcome("skipped", "routing markers unavailable for this version");
      // Assistant speech only — see assistantText(): the raw transcript contains files the
      // model read, and the Algorithm file it is SUPPOSED to read carries banner examples.
      return matches(assistantText(context.transcript), marker) ? pass(`matched ${mode} routing marker`) : fail(`missing ${mode} routing marker`);
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
