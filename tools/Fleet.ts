import { arg, exists, json, path } from "./Common.ts";

export type Cell = {
  version: string;
  model: string;
  prompt: string;
  trial: number;
  tier: string;
  engine: "claude" | "gpt";
};
type BenchConfig = {
  versions: Array<{ id: string }>;
  models: Array<{ id: string }>;
  gpt_models?: Array<{ id: string; versions: string[] }>;
  trials: Record<string, number>;
  expected_runs: number;
  runner: { concurrency: number };
};
type GoldenSet = { prompts: Array<{ id: string; tier: string }> };

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error("--limit must be a non-negative integer");
  return Number(raw);
}

function promptTrials(config: BenchConfig, tier: string): number {
  const trials = config.trials[tier];
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`invalid trial count for tier ${tier}`);
  return trials;
}

/** Enumerate both engines while retaining distinct result lanes for prompt-only GPT runs. */
export function enumerate(config: BenchConfig, golden: GoldenSet): Cell[] {
  const cells: Cell[] = [];
  for (const version of config.versions) {
    for (const model of config.models) {
      for (const prompt of golden.prompts) {
        for (let trial = 1; trial <= promptTrials(config, prompt.tier); trial++) {
          cells.push({ version: version.id, model: model.id, prompt: prompt.id, trial, tier: prompt.tier, engine: "claude" });
        }
      }
    }
  }
  if (cells.length !== config.expected_runs) {
    throw new Error(`configuration expected ${config.expected_runs} Claude runs but enumerated ${cells.length}`);
  }

  const knownVersions = new Set(config.versions.map(({ id }) => id));
  for (const model of config.gpt_models ?? []) {
    if (!Array.isArray(model.versions) || model.versions.length === 0) throw new Error(`GPT model ${model.id} has no versions`);
    for (const version of model.versions) {
      if (!knownVersions.has(version)) throw new Error(`GPT model ${model.id} references unknown version ${version}`);
      for (const prompt of golden.prompts) {
        for (let trial = 1; trial <= promptTrials(config, prompt.tier); trial++) {
          cells.push({ version, model: model.id, prompt: prompt.id, trial, tier: prompt.tier, engine: "gpt" });
        }
      }
    }
  }
  return cells;
}

function resultVersion(cell: Cell): string {
  return cell.engine === "gpt" ? `${cell.version}-GPT` : cell.version;
}

async function completedSuccessfully(cell: Cell): Promise<boolean> {
  const metaFile = path("results", "phase1", resultVersion(cell), cell.model, cell.prompt, `trial-${cell.trial}`, "meta.json");
  if (!(await exists(metaFile))) return false;
  try {
    const meta = await json<{ status?: string }>(metaFile);
    return meta.status === "success";
  } catch {
    return false;
  }
}

async function runCell(cell: Cell): Promise<Record<string, unknown>> {
  if (await completedSuccessfully(cell)) return { ...cell, status: "skipped_success" };
  try {
    const runner = cell.engine === "gpt" ? "tools/RunCellGpt.ts" : "tools/RunCell.ts";
    const proc = Bun.spawn([
      "bun", runner,
      "--version", cell.version,
      "--model", cell.model,
      "--prompt", cell.prompt,
      "--trial", String(cell.trial),
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const finalLine = stdout.split(/\r?\n/).filter(Boolean).at(-1);
    let result: unknown = finalLine ?? "";
    if (finalLine) {
      try { result = JSON.parse(finalLine); } catch { /* Preserve non-JSON child output as evidence. */ }
    }
    return { ...cell, status: exitCode === 0 ? "completed" : "runner_failed", exit_code: exitCode, result, ...(stderr.trim() ? { stderr: stderr.trim() } : {}) };
  } catch (error) {
    return { ...cell, status: "runner_failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const config = await json<BenchConfig>(path("bench.config.json"));
  const golden = await json<GoldenSet>(path("goldenset", "goldenset.json"));
  const limit = parseLimit(arg("--limit"));
  const allCells = enumerate(config, golden);
  const selected = limit === undefined ? allCells : allCells.slice(0, limit);

  if (Bun.argv.includes("--dry-run")) {
    // Deliberately no summary/header: each output line is one cell, so wc equals the run count.
    for (const cell of selected) console.log(JSON.stringify(cell));
    return;
  }

  const concurrency = Number(config.runner.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("runner concurrency must be a positive integer");
  let next = 0;
  const workers = Math.min(concurrency, selected.length);
  const worker = async (): Promise<void> => {
    while (true) {
      const cell = selected[next++];
      if (!cell) return;
      console.log(JSON.stringify(await runCell(cell)));
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

if (import.meta.main) await main();
