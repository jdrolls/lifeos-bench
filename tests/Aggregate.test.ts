import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BenchConfig, type GoldenSet, type Row, graderKinds, laneMetrics, lanesFor, latestRows, percent, ratio, scheduledPrompts, taskPromptCount } from "../tools/Aggregate.ts";

const config: BenchConfig = {
  versions: [
    { id: "RAW", models_allowlist: ["sonnet-5"] },
    { id: "L7" },
  ],
  models: [{ id: "sonnet-5", cli_arg: "claude-sonnet-5" }, { id: "haiku-4-5", cli_arg: "claude-haiku" }],
  trials: { T1: 1, T5: 2 },
};

const golden: GoldenSet = {
  version: "test",
  prompts: [
    {
      id: "t1-edit", tier: "T1",
      expectations: [
        { grader: "code:algorithm_read", expect: "read", name: "algorithm_read" },
        { grader: "code:format_compliance", name: "format_compliance" },
        { grader: "file_contains", name: "edited" },
      ],
    },
    {
      id: "t5-focus", tier: "T5",
      expectations: [
        { grader: "regex", name: "cites_real_projects" },
        { grader: "judge:rubric", name: "grounding_quality", rubric: "grounding", min_score: 3 },
      ],
    },
  ],
};

async function emptyResults(): Promise<string> {
  return mkdtemp(join(tmpdir(), "lifeos-bench-aggregate-"));
}

function row(partial: Partial<Row> & Pick<Row, "version" | "model" | "prompt_id" | "trial" | "grader" | "status">): Row {
  return partial as Row;
}

describe("latestRows", () => {
  test("a later row for the same grader supersedes the earlier one", () => {
    const first = JSON.stringify(row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "fail" }));
    const second = JSON.stringify(row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }));
    const rows = latestRows(`${first}\n${second}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
  });

  test("a partially written line is ignored rather than throwing", () => {
    const good = JSON.stringify(row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }));
    expect(latestRows(`{"version":"L7","mod\n${good}\n`)).toHaveLength(1);
  });

  test("judge rows merge over grade rows across sources", () => {
    const pending = JSON.stringify(row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "pending_judge" }));
    const judged = JSON.stringify(row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "pass", score: 5 }));
    const rows = latestRows(pending, judged);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
  });
});

describe("grader classification", () => {
  test("routing and format are keyed by grader type, not by name prefix", () => {
    const kinds = graderKinds(golden);
    expect([...kinds.algorithmEntry]).toEqual(["t1-edit|algorithm_read"]);
    expect([...kinds.format]).toEqual(["t1-edit|format_compliance"]);
    expect([...kinds.routing]).toEqual([]);
  });

  // The single largest effect in this benchmark was hidden by averaging these together: every
  // version correctly skips the Algorithm for "thanks, that's all for now", so folding the skip
  // checks into the entry rate drags a 0-of-6 up toward a passing-looking number.
  test("algorithm_read splits on the golden set's own expect field, not on the grader name", () => {
    const split: GoldenSet = {
      version: "test",
      prompts: [{
        id: "t3-build", tier: "T3",
        expectations: [
          { grader: "code:algorithm_read", expect: "read", name: "algorithm_entered" },
          { grader: "code:algorithm_read", expect: "not_read", name: "algorithm_skipped" },
          { grader: "code:routing", expect_mode: "heavy", name: "routed_heavy" },
        ],
      }],
    };
    const kinds = graderKinds(split);
    expect([...kinds.algorithmEntry]).toEqual(["t3-build|algorithm_entered"]);
    expect([...kinds.algorithmSkip]).toEqual(["t3-build|algorithm_skipped"]);
    expect([...kinds.routing]).toEqual(["t3-build|routed_heavy"]);
  });

  test("an entry check that fails does not borrow credit from a passing skip check", async () => {
    const split: GoldenSet = {
      version: "test",
      prompts: [
        { id: "t3-build", tier: "T1", expectations: [{ grader: "code:algorithm_read", expect: "read", name: "algorithm_entered" }] },
        { id: "t1-ack", tier: "T1", expectations: [{ grader: "code:algorithm_read", expect: "not_read", name: "algorithm_skipped" }] },
      ],
    };
    const rows = [
      row({ version: "L7", model: "sonnet-5", prompt_id: "t3-build", trial: 1, grader: "algorithm_entered", status: "fail" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t1-ack", trial: 1, grader: "algorithm_skipped", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden: split, config, version: "L7", model: "sonnet-5", resultsRoot: await emptyResults() });
    expect(metric.algorithmEntryPass).toBe(0);
    expect(metric.algorithmEntryTotal).toBe(1);
    expect(metric.algorithmSkipPass).toBe(1);
    expect(metric.algorithmSkipTotal).toBe(1);
    // And neither leaks into the task bucket.
    expect(metric.taskPrompts).toBe(0);
  });

  test("a prompt whose only expectations are routing/format is not a task prompt", () => {
    expect(taskPromptCount(golden.prompts)).toBe(2);
    expect(taskPromptCount([{ id: "x", tier: "T1", expectations: [{ grader: "code:routing", name: "r" }] }])).toBe(0);
  });
});

describe("laneMetrics", () => {
  test("routing, format and task graders land in their own buckets", async () => {
    const rows = [
      row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "algorithm_read", status: "pass" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "format_compliance", status: "fail" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "L7", model: "sonnet-5", tier: "T1", resultsRoot: await emptyResults() });
    expect(metric.algorithmEntryPass).toBe(1);
    expect(metric.algorithmEntryTotal).toBe(1);
    expect(metric.formatPass).toBe(0);
    expect(metric.formatTotal).toBe(1);
    expect(metric.anyPass).toBe(1);
    expect(metric.allPass).toBe(1);
  });

  // Regression: Report.ts used `task.every(row => row.status === "pass")`, so a documented
  // skip — the control cannot know the persona, so its grounding checks skip by design —
  // turned a passing trial into a failing one. It penalised only the version the golden set
  // exempts, which is the control, biasing the benchmark toward its own null hypothesis.
  test("a skipped task grader does not suppress a pass", async () => {
    const rows = [
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "cites_real_projects", status: "skipped" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "pass" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 2, grader: "cites_real_projects", status: "skipped" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 2, grader: "grounding_quality", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "RAW", model: "sonnet-5", tier: "T5", resultsRoot: await emptyResults() });
    expect(metric.anyPass).toBe(1);
    expect(metric.allPass).toBe(1);
  });

  test("a trial whose task graders are all skipped contributes no verdict at all", async () => {
    const rows = [
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "cites_real_projects", status: "skipped" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "skipped" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "RAW", model: "sonnet-5", tier: "T5", resultsRoot: await emptyResults() });
    expect(metric.anyPass).toBe(0);
    expect(metric.allPass).toBe(0);
  });

  test("a routing or format grader that skipped is excluded from its denominator", async () => {
    const rows = [
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "algorithm_read", status: "skipped" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "format_compliance", status: "skipped" }),
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "RAW", model: "sonnet-5", tier: "T1", resultsRoot: await emptyResults() });
    expect(metric.algorithmEntryTotal).toBe(0);
    expect(metric.formatTotal).toBe(0);
    expect(percent(metric.algorithmEntryPass, metric.algorithmEntryTotal)).toBe("—");
  });

  test("pass@k counts a prompt passing on one trial; pass^k requires every trial", async () => {
    const rows = [
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "cites_real_projects", status: "pass" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "pass" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 2, grader: "cites_real_projects", status: "fail" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 2, grader: "grounding_quality", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "L7", model: "sonnet-5", tier: "T5", resultsRoot: await emptyResults() });
    expect(metric.anyPass).toBe(1);
    expect(metric.allPass).toBe(0);
  });

  test("a still-pending judge row leaves the trial unjudged rather than failed", async () => {
    const rows = [
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "cites_real_projects", status: "pass" }),
      row({ version: "L7", model: "sonnet-5", prompt_id: "t5-focus", trial: 1, grader: "grounding_quality", status: "pending_judge" }),
    ];
    const metric = await laneMetrics({ rows, golden, config, version: "L7", model: "sonnet-5", tier: "T5", resultsRoot: await emptyResults() });
    expect(metric.anyPass).toBe(1);
  });

  test("cell facts are summed from meta.json and hook state is counted only where recorded", async () => {
    const resultsRoot = await emptyResults();
    const trialDir = join(resultsRoot, "L7", "sonnet-5", "t1-edit", "trial-1");
    await Bun.write(join(trialDir, "meta.json"), JSON.stringify({
      status: "success", wall_clock_ms: 2000, total_cost_usd: 0.25,
      token_usage: { output_tokens: 400 }, hook_state: { files_written: 24 },
    }));
    const metric = await laneMetrics({ rows: [], golden, config, version: "L7", model: "sonnet-5", tier: "T1", resultsRoot });
    expect(metric.cells).toBe(1);
    expect(metric.outputTokens).toBe(400);
    expect(metric.wallClockMs).toBe(2000);
    expect(metric.costUsd).toBeCloseTo(0.25);
    expect(metric.hookFilesWritten).toBe(24);
    expect(metric.hookCells).toBe(1);
    expect(metric.statuses).toEqual({ success: 1 });
  });

  test("a cell with no hook_state block is absent from the hook mean, not counted as zero", async () => {
    const resultsRoot = await emptyResults();
    await Bun.write(join(resultsRoot, "RAW", "sonnet-5", "t1-edit", "trial-1", "meta.json"),
      JSON.stringify({ status: "success", wall_clock_ms: 1000, token_usage: { output_tokens: 10 } }));
    const metric = await laneMetrics({ rows: [], golden, config, version: "RAW", model: "sonnet-5", tier: "T1", resultsRoot });
    expect(metric.cells).toBe(1);
    expect(metric.hookCells).toBe(0);
  });

  test("an unreadable meta.json is skipped rather than aborting the report", async () => {
    const resultsRoot = await emptyResults();
    const file = join(resultsRoot, "L7", "sonnet-5", "t1-edit", "trial-1", "meta.json");
    await Bun.write(file, "{ not json");
    await writeFile(file, "{ not json");
    const metric = await laneMetrics({ rows: [], golden, config, version: "L7", model: "sonnet-5", tier: "T1", resultsRoot });
    expect(metric.cells).toBe(0);
  });
});

describe("scheduled prompts", () => {
  const restricted: BenchConfig = { ...config, tier_models: { T5: ["sonnet-5"] } };

  test("a tier restricted by tier_models is absent from the lanes that never ran it", () => {
    expect(scheduledPrompts(golden, restricted, "sonnet-5").map((prompt) => prompt.id)).toEqual(["t1-edit", "t5-focus"]);
    expect(scheduledPrompts(golden, restricted, "haiku-4-5").map((prompt) => prompt.id)).toEqual(["t1-edit"]);
  });

  // Regression: pass@k divided by ALL prompts regardless of tier_models, so six of eight model
  // lanes were graded on five T5 prompts they were never scheduled to run — each counted as a
  // failure. It understated every restricted lane and produced the published claim that no
  // model reaches 100% without a scaffold.
  test("a lane is not charged for prompts it was never scheduled to run", async () => {
    const rows = [
      row({ version: "RAW", model: "haiku-4-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config: restricted, version: "RAW", model: "haiku-4-5", resultsRoot: await emptyResults() });
    expect(metric.taskPrompts).toBe(1);
    expect(metric.anyPass).toBe(1);
    expect(percent(metric.anyPass, metric.taskPrompts)).toBe("100.0%");
  });

  test("the lane that DID run the restricted tier still carries it in its denominator", async () => {
    const rows = [
      row({ version: "RAW", model: "sonnet-5", prompt_id: "t1-edit", trial: 1, grader: "edited", status: "pass" }),
    ];
    const metric = await laneMetrics({ rows, golden, config: restricted, version: "RAW", model: "sonnet-5", resultsRoot: await emptyResults() });
    expect(metric.taskPrompts).toBe(2);
    expect(metric.anyPass).toBe(1);
  });
});

describe("lane selection and formatting", () => {
  test("a restricted version renders only its allowlisted models", () => {
    expect(lanesFor(config, config.versions[0]).map((model) => model.id)).toEqual(["sonnet-5"]);
    expect(lanesFor(config, config.versions[1]).map((model) => model.id)).toEqual(["sonnet-5", "haiku-4-5"]);
  });

  test("a zero denominator is an em-dash, never 0% or NaN", () => {
    expect(percent(0, 0)).toBe("—");
    expect(percent(3, 4)).toBe("75.0%");
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 4)).toBe(75);
  });
});
