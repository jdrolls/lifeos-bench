import { expect, test } from "bun:test";
import { enumerate } from "../tools/Fleet.ts";
import { json, path } from "../tools/Common.ts";

/**
 * Derive the expectation from the config rather than hard-coding a total. The previous
 * version pinned 264 from the Phase-2 matrix and silently went stale the moment a lane was
 * added — a failing suite that everyone learns to ignore hides the next real regression.
 */
test("Fleet enumerates exactly the configured matrix", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  const trialsPerPrompt = golden.prompts.reduce(
    (total: number, prompt: any) => total + config.trials[prompt.tier],
    0,
  );
  const claudeExpected = config.versions.length * config.models.length * trialsPerPrompt;
  const gptExpected = (config.gpt_models ?? []).reduce(
    (total: number, model: any) => total + model.versions.length * trialsPerPrompt,
    0,
  );

  expect(cells.filter((cell) => cell.engine === "claude")).toHaveLength(claudeExpected);
  expect(cells.filter((cell) => cell.engine === "gpt")).toHaveLength(gptExpected);
  expect(cells).toHaveLength(claudeExpected + gptExpected);
  // enumerate() cross-checks against expected_runs itself; assert the config agrees.
  expect(config.expected_runs).toBe(claudeExpected);
});

test("every enumerated version and model is declared in config", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  const versions = new Set(config.versions.map((version: any) => version.id));
  const models = new Set([
    ...config.models.map((model: any) => model.id),
    ...(config.gpt_models ?? []).map((model: any) => model.id),
  ]);
  expect(cells.every((cell) => versions.has(cell.version))).toBe(true);
  expect(cells.every((cell) => models.has(cell.model))).toBe(true);
});
