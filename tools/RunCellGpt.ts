import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arg, changed, copyTree, ensure, exists, gitWorkspaceDiff, json, path, reset, snapshot, writeJson } from "./Common.ts";
import { gradeTrial } from "./Grade.ts";
import { writePromptPack } from "./PromptPack.ts";

type BenchConfig = {
  versions: Array<{ id: string }>;
  gpt_models?: Array<{ id: string; versions: string[] }>;
  runner: { timeout_per_run_s: number };
};
type GoldenSet = { prompts: Array<{ id: string; prompt: string; fixture: string | null }> };

type GptMetaInput = {
  version: string;
  model: string;
  promptId: string;
  trial: number;
  fixture: string | null;
  status: "success" | "failed" | "timeout";
  exitCode: number | null;
  wallClockMs: number;
  changedFiles: string[];
  baseline: Record<string, string>;
  finalMessage: string;
  launchError?: string;
  workspaceDiffError?: string;
};

/** Kept separate so the GPT runner writes the same stable metadata contract as RunCell. */
export function gptMeta(input: GptMetaInput): Record<string, unknown> {
  return {
    version: input.version,
    model: input.model,
    prompt_id: input.promptId,
    trial: input.trial,
    fixture: input.fixture,
    status: input.status,
    exit_code: input.exitCode,
    wall_clock_ms: input.wallClockMs,
    token_usage: {},
    final_message: input.finalMessage,
    changed_files: input.changedFiles,
    baseline: input.baseline,
    ...(input.launchError ? { launch_error: input.launchError } : {}),
    ...(input.workspaceDiffError ? { workspace_diff_error: input.workspaceDiffError } : {}),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function renderCodexCommand(template: string, promptFile: string, workspace: string): string {
  if (!template.includes("{promptfile}") || !template.includes("{workspace}")) {
    throw new Error("CODEX_RUN_CMD must contain both {promptfile} and {workspace}");
  }
  return template
    .replaceAll("{promptfile}", shellQuote(promptFile))
    .replaceAll("{workspace}", shellQuote(workspace));
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* Process already exited. */ }
  }
}

async function main(): Promise<void> {
  const version = arg("--version");
  const model = arg("--model");
  const promptId = arg("--prompt");
  const trial = Number(arg("--trial"));
  if (!version || !model || !promptId || !Number.isInteger(trial) || trial < 1) {
    throw new Error("usage: bun tools/RunCellGpt.ts --version V --model M --prompt ID --trial N");
  }

  const config = await json<BenchConfig>(path("bench.config.json"));
  const golden = await json<GoldenSet>(path("goldenset", "goldenset.json"));
  const prompt = golden.prompts.find((candidate) => candidate.id === promptId);
  const selectedModel = config.gpt_models?.find((candidate) => candidate.id === model);
  if (!prompt || !selectedModel || !selectedModel.versions.includes(version) || !config.versions.some((candidate) => candidate.id === version)) {
    throw new Error("unknown GPT version, model, or prompt");
  }

  const sandbox = path("sandboxes", version);
  if (!(await exists(sandbox))) throw new Error(`sandbox has not been staged: ${sandbox}`);
  const laneVersion = `${version}-GPT`;
  const output = path("results", "phase1", laneVersion, model, promptId, `trial-${trial}`);
  const workspace = join(output, "workspace");
  const baselineDirectory = join(output, "baseline");
  await reset(output);
  await ensure(workspace);
  if (prompt.fixture) await copyTree(path("fixtures", prompt.fixture), workspace);

  const packFile = await writePromptPack(version);
  const promptPack = await Bun.file(packFile).text();
  const promptFile = join(workspace, ".lifeos-bench-prompt.md");
  await writeFile(promptFile, `${promptPack}\n\n# Task\n${prompt.prompt}`);
  await copyTree(workspace, baselineDirectory);
  const before = await snapshot(workspace);
  const startedAt = Date.now();

  const template = process.env.CODEX_RUN_CMD;
  if (!template) throw new Error("CODEX_RUN_CMD is required to run GPT cells");
  const command = renderCodexCommand(template, promptFile, workspace);
  const environment: Record<string, string | undefined> = { ...process.env };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.CLAUDECODE;

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;
  let launchError: string | undefined;
  try {
    const child = spawn("bash", ["-lc", command], { cwd: workspace, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const timeoutMs = Number(config.runner.timeout_per_run_s) * 1_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("runner timeout_per_run_s must be positive");
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      if (child.pid) terminateProcessGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => { if (child.pid) terminateProcessGroup(child.pid, "SIGKILL"); }, 5_000);
    }, timeoutMs);
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });
    } finally {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    }
  } catch (error) {
    launchError = error instanceof Error ? error.message : String(error);
    stderr = `${stderr}${stderr ? "\n" : ""}${launchError}`;
  }

  const transcript = stdout.length === 0 || stdout.endsWith("\n") ? stdout : `${stdout}\n`;
  // Grade.ts intentionally has one transcript path for all engines. Keep the native text
  // transcript too, and mirror it at that established path rather than changing grader logic.
  await writeFile(join(output, "transcript.txt"), transcript);
  await writeFile(join(output, "transcript.jsonl"), transcript);
  if (stderr) await writeFile(join(output, "stderr.txt"), stderr);

  const after = await snapshot(workspace);
  const diff = await gitWorkspaceDiff(baselineDirectory, workspace);
  await writeFile(join(output, "workspace-diff.txt"), diff.diff || "No workspace changes\n");
  const meta = gptMeta({
    version: laneVersion,
    model,
    promptId,
    trial,
    fixture: prompt.fixture,
    status: timedOut ? "timeout" : exitCode === 0 && !diff.error ? "success" : "failed",
    exitCode,
    wallClockMs: Date.now() - startedAt,
    changedFiles: changed(before, after),
    baseline: before,
    finalMessage: transcript.trimEnd(),
    launchError,
    workspaceDiffError: diff.error,
  });
  await writeJson(join(output, "meta.json"), meta);

  const grades = await gradeTrial(laneVersion, model, promptId, trial);
  console.log(JSON.stringify({
    version: laneVersion,
    model,
    prompt_id: promptId,
    trial,
    status: meta.status,
    exit_code: exitCode,
    grades: grades.map(({ grader, status }) => ({ grader, status })),
  }));
}

if (import.meta.main) await main();
