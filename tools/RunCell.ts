import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { arg, changed, copyTree, ensure, exists, gitWorkspaceDiff, json, path, reset, snapshot, writeJson } from "./Common.ts";
import { gradeTrial } from "./Grade.ts";
import { leakCheck } from "./LeakCheck.ts";
import { claudeBinary, cliShimDirectory, configRoot, prepareFakeHome, runWorkspace, sanitizeEnvironment, writeSeatbeltProfile } from "./Sandbox.ts";

type ResultEvent = {
  type?: string;
  result?: string;
  usage?: Record<string, number>;
  total_cost_usd?: number;
};

type BenchConfig = {
  models: Array<{ id: string; cli_arg: string; engine?: "claudex" }>;
  // system_prompt is the version's constitutional file, relative to its sandbox. Upstream
  // installs load it via --append-system-prompt-file; omitting it (as Phases 1-3 did) runs
  // the scaffold without the layer that defines its response format and verification rules.
  versions: Array<{ id: string; system_prompt?: string | null }>;
  runner: { timeout_per_run_s: number };
};
type GoldenSet = { prompts: Array<{ id: string; prompt: string; fixture: string | null }> };

function finalResultEvent(transcript: string): ResultEvent | undefined {
  for (const line of transcript.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ResultEvent;
      if (event.type === "result") return event;
    } catch {
      // Keep malformed output in transcript.jsonl; it is still useful run evidence.
    }
  }
  return undefined;
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // If the process has not created its session yet, signal the launcher itself.
    try { process.kill(pid, signal); } catch { /* The process already exited. */ }
  }
}

/**
 * Kill anything the cell left running that still names its own trial directory.
 *
 * Killing the child's process group is not sufficient: cells building a page reach for a real
 * browser to screenshot it, and headless Chrome detaches from the group and survives. Those
 * orphans accumulated across a wave — four live Chrome trees and a background http.server at one
 * point, with machine load at 13 on 8 cores. That is not just untidy: concurrent cells then
 * contend for CPU and for fixed ports, which inflates wall-clock and plausibly produced the
 * 1200s "timeouts" on cells that had made two tool calls.
 *
 * Matching on the trial directory is deliberately narrow — it can only ever match a process this
 * cell started, never the operator's own browser, editor, or servers.
 */
async function reapEscapedProcesses(trialDirectory: string): Promise<void> {
  try {
    const listing = Bun.spawnSync(["ps", "-Ao", "pid=,command="]);
    const lines = new TextDecoder().decode(listing.stdout).split("\n");
    for (const line of lines) {
      if (!line.includes(trialDirectory)) continue;
      const pid = Number(line.trim().split(/\s+/)[0]);
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) continue;
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
  } catch {
    // Reaping is hygiene, never a reason to fail a completed cell.
  }
}

async function main(): Promise<void> {
  const version = arg("--version");
  const model = arg("--model");
  const promptId = arg("--prompt");
  const trial = Number(arg("--trial"));
  if (!version || !model || !promptId || !Number.isInteger(trial) || trial < 1) {
    throw new Error("usage: bun tools/RunCell.ts --version V --model M --prompt ID --trial N");
  }

  const config = await json<BenchConfig>(path("bench.config.json"));
  const golden = await json<GoldenSet>(path("goldenset", "goldenset.json"));
  const prompt = golden.prompts.find((candidate) => candidate.id === promptId);
  const selectedModel = config.models.find((candidate) => candidate.id === model);
  const selectedVersion = config.versions.find((candidate) => candidate.id === version);
  if (!prompt || !selectedModel || !selectedVersion) {
    throw new Error("unknown version, model, or prompt");
  }

  const sandbox = configRoot(version);
  if (!(await exists(sandbox))) throw new Error(`sandbox has not been staged: ${sandbox}`);

  // Fail loud rather than silently benchmarking a scaffold stripped of its constitutional layer.
  let systemPromptFile: string | undefined;
  if (selectedVersion.system_prompt) {
    systemPromptFile = join(sandbox, selectedVersion.system_prompt);
    if (!(await exists(systemPromptFile))) {
      throw new Error(`${version} declares system_prompt ${selectedVersion.system_prompt} but it is missing from the sandbox`);
    }
  }
  const output = path("results", "phase1", version, model, promptId, `trial-${trial}`);
  const workspace = join(output, "workspace");
  const baselineDirectory = join(output, "baseline");
  await reset(output);
  await ensure(workspace);
  if (prompt.fixture) await copyTree(path("fixtures", prompt.fixture), workspace);
  await copyTree(workspace, baselineDirectory);

  // The cell runs OUTSIDE the operator home and is copied back afterwards. See
  // Sandbox.runWorkspaceRoot: a Bun process with cwd inside the denied home gets an empty
  // process.env, which silently disabled every hook-based router in the scaffolds under test.
  const liveWorkspace = runWorkspace(version, model, promptId, trial);
  await reset(liveWorkspace);
  await copyTree(workspace, liveWorkspace);

  const before = await snapshot(workspace);
  const startedAt = Date.now();
  // HOME redirect is the fidelity half of isolation: every scaffold references
  // `~/.claude/...` thousands of times, and those must resolve to the STAGED install.
  const fakeHome = await prepareFakeHome(version);
  const cliBinary = await claudeBinary();
  const environment: Record<string, string | undefined> = {
    ...sanitizeEnvironment(process.env, undefined, cliShimDirectory(version)),
    CLAUDE_CONFIG_DIR: sandbox,
    HOME: fakeHome,
  };
  delete environment.ANTHROPIC_API_KEY;
  delete environment.ANTHROPIC_AUTH_TOKEN;
  delete environment.CLAUDECODE;
  if (selectedModel.engine === "claudex") {
    // claudex lane: same CC harness, GPT backend via the local CLIProxyAPI. Proxy key
    // replaces Anthropic auth; ChatGPT-side billing is flat-rate through the proxy.
    environment.ANTHROPIC_BASE_URL = Bun.env.CLAUDEX_PROXY_URL ?? "http://127.0.0.1:8317";
    environment.ANTHROPIC_AUTH_TOKEN = Bun.env.CLAUDEX_PROXY_KEY ?? "claudex-local";
    delete environment.CLAUDE_CODE_OAUTH_TOKEN;
    // CC and the scaffolds reference Claude models by tier (utility calls on haiku,
    // scaffold-pinned sonnet, etc.); the proxy only routes GPT ids (502 "unknown
    // provider for claude-*"). Mirror the claudex wrapper's full tier mapping.
    environment.ANTHROPIC_DEFAULT_HAIKU_MODEL = "gpt-5.6-luna";
    environment.ANTHROPIC_DEFAULT_SONNET_MODEL = "gpt-5.6-terra";
    environment.ANTHROPIC_DEFAULT_OPUS_MODEL = "gpt-5.6-sol";
    environment.ANTHROPIC_DEFAULT_FABLE_MODEL = "gpt-5.6-sol";
    environment.CLAUDE_CODE_SUBAGENT_MODEL = "inherit";
    environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  } else {
    // Long-lived subscription token from `claude setup-token` (see README): rotation-free,
    // so parallel sandboxes never clobber each other's refresh chains — or the live one.
    const tokenFile = path("sandboxes", "_auth", "oauth-token");
    const oauthToken = (await Bun.file(tokenFile).text().catch(() => "")).trim();
    if (!oauthToken) throw new Error(`missing ${tokenFile} — run setup-token capture before benchmarking`);
    environment.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  }

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;
  let launchError: string | undefined;
  // Recorded into meta.json: a benchmark claim is only reproducible if the exact invocation
  // is on record. The missing --append-system-prompt-file in Phases 1-3 was invisible partly
  // because nothing ever wrote down what was actually run.
  let spawnArgv: string[] = [];
  try {
    // detached:true gives the CLI its own process group (macOS ships no setsid), so the
    // timeout can terminate the whole tree rather than orphaning the CLI's children.
    const claudeArguments = [
      "-p", prompt.prompt,
      "--model", selectedModel.cli_arg,
      "--output-format", "stream-json",
      // stream-json in print mode requires --verbose; sandboxed synthetic workspaces get
      // the same permission mode on every lane so no framework wins on permission prompts.
      "--verbose",
      "--permission-mode", "bypassPermissions",
      ...(systemPromptFile ? ["--append-system-prompt-file", systemPromptFile] : []),
    ];
    // Seatbelt is the safety half: bypassPermissions removes every in-harness check, so the
    // kernel has to be the thing that says no. Profile is written beside the artifacts so a
    // contaminated cell can be reproduced exactly.
    const profileFile = await writeSeatbeltProfile({ fakeHome, configRoot: sandbox, workspace: liveWorkspace, trialDirectory: output });
    spawnArgv = ["/usr/bin/sandbox-exec", "-f", profileFile, await claudeBinary(), ...claudeArguments];
    const child = spawn(spawnArgv[0], spawnArgv.slice(1), { cwd: liveWorkspace, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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

  await reapEscapedProcesses(output);
  await reapEscapedProcesses(liveWorkspace);

  // Bring the cell's work back beside its artifacts so grading, diffing and LeakCheck all read
  // the same tree they always have; nothing downstream needs to know the run happened elsewhere.
  await reset(workspace);
  await copyTree(liveWorkspace, workspace);
  await rm(liveWorkspace, { recursive: true, force: true });

  const transcript = stdout.length === 0 || stdout.endsWith("\n") ? stdout : `${stdout}\n`;
  await writeFile(join(output, "transcript.jsonl"), transcript);
  if (stderr) await writeFile(join(output, "stderr.txt"), stderr);

  const after = await snapshot(workspace);
  const changedFiles = changed(before, after);
  const diff = await gitWorkspaceDiff(baselineDirectory, workspace);
  await writeFile(join(output, "workspace-diff.txt"), diff.diff || "No workspace changes\n");

  const result = finalResultEvent(transcript);
  // A cell that reached outside its sandbox is not a data point. Its behaviour was shaped by
  // material the version under test does not ship, or by a kernel refusal it had to react to.
  // Mark it invalid here so it can never be graded into a headline.
  const violations = await leakCheck(output);
  const meta = {
    version,
    model,
    prompt_id: promptId,
    trial,
    fixture: prompt.fixture,
    status: violations.length > 0
      ? "contaminated"
      : timedOut ? "timeout" : exitCode === 0 && !diff.error ? "success" : "failed",
    ...(violations.length > 0
      ? { containment_violations: violations.slice(0, 20), containment_violation_count: violations.length }
      : {}),
    exit_code: exitCode,
    wall_clock_ms: Date.now() - startedAt,
    token_usage: result?.usage ?? {},
    final_message: result?.result ?? "",
    total_cost_usd: result?.total_cost_usd,
    changed_files: changedFiles,
    baseline: before,
    command: spawnArgv,
    system_prompt_file: systemPromptFile ?? null,
    // Isolation provenance: a later reader should be able to confirm the boundary from the
    // artifact alone, without re-probing a machine whose state has since moved on.
    isolation: { home: fakeHome, config_dir: sandbox, seatbelt_profile: join(output, "sandbox.sb"), run_workspace: liveWorkspace },
    ...(launchError ? { launch_error: launchError } : {}),
    ...(diff.error ? { workspace_diff_error: diff.error } : {}),
  };
  await writeJson(join(output, "meta.json"), meta);

  const grades = await gradeTrial(version, model, promptId, trial);
  console.log(JSON.stringify({
    version,
    model,
    prompt_id: promptId,
    trial,
    status: meta.status,
    exit_code: exitCode,
    grades: grades.map(({ grader, status }) => ({ grader, status })),
  }));
}

if (import.meta.main) await main();
