import { arg, exists, json, path } from "./Common.ts";

type Cell = { version: string; model: string; prompt: string; trial: number; tier: string };
type BenchConfig = {
  versions: Array<{ id: string }>;
  models: Array<{ id: string }>;
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

function enumerate(config: BenchConfig, golden: GoldenSet): Cell[] {
  const cells: Cell[] = [];
  for (const version of config.versions) {
    for (const model of config.models) {
      for (const prompt of golden.prompts) {
        const trials = config.trials[prompt.tier];
        if (!Number.isInteger(trials) || trials < 1) throw new Error(`invalid trial count for tier ${prompt.tier}`);
        for (let trial = 1; trial <= trials; trial++) {
          cells.push({ version: version.id, model: model.id, prompt: prompt.id, trial, tier: prompt.tier });
        }
      }
    }
  }
  if (cells.length !== config.expected_runs) {
    throw new Error(`configuration expected ${config.expected_runs} runs but enumerated ${cells.length}`);
  }
  return cells;
}

async function completedSuccessfully(cell: Cell): Promise<boolean> {
  const metaFile = path("results", "phase1", cell.version, cell.model, cell.prompt, `trial-${cell.trial}`, "meta.json");
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
    const proc = Bun.spawn([
      "bun", "tools/RunCell.ts",
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
  const selected = (limit === undefined ? enumerate(config, golden) : enumerate(config, golden).slice(0, limit));

  if (Bun.argv.includes("--dry-run")) {
    // Deliberately no summary/header: each output line is one cell, so `wc -l`
    // equals the requested run count (144 for the frozen Phase-1 matrix).
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
      // One and only one progress JSON record is emitted after each selected cell settles.
      console.log(JSON.stringify(await runCell(cell)));
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

if (import.meta.main) await main();
