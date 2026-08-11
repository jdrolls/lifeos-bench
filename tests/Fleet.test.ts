import { expect, test } from "bun:test";
import { enumerate, selectCells } from "../tools/Fleet.ts";
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

  // Mirror enumerate()'s narrowing: a version may allow a subset of models, and a tier may
  // narrow further on top of that.
  const claudeExpected = config.versions.reduce((versionTotal: number, version: any) => {
    const versionModels = version.models_allowlist
      ? config.models.filter((model: any) => version.models_allowlist.includes(model.id))
      : config.models;
    return versionTotal + versionModels.reduce((modelTotal: number, model: any) => {
      return modelTotal + golden.prompts.reduce((promptTotal: number, prompt: any) => {
        const tierModels = config.tier_models?.[prompt.tier];
        if (tierModels && !tierModels.includes(model.id)) return promptTotal;
        return promptTotal + config.trials[prompt.tier];
      }, 0);
    }, 0);
  }, 0);
  const trialsPerPrompt = golden.prompts.reduce(
    (total: number, prompt: any) => total + config.trials[prompt.tier],
    0,
  );
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

test("Fleet --versions selects only requested versions", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  const selected = selectCells(cells, config.versions.map((version: any) => version.id), "L5,L6", undefined);

  expect(selected).toEqual(cells.filter((cell) => cell.version === "L5" || cell.version === "L6"));
  expect(selected).toHaveLength(280);
});

test("Fleet --versions filters before applying --limit", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  const selected = selectCells(cells, config.versions.map((version: any) => version.id), "L5,L6", 5);
  const versionSelected = cells.filter((cell) => cell.version === "L5" || cell.version === "L6");

  expect(selected).toEqual(versionSelected.slice(0, 5));
});

test("Fleet --versions rejects unknown version ids", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  expect(() => selectCells(cells, config.versions.map((version: any) => version.id), "L5,unknown", undefined))
    .toThrow("unknown version id(s): unknown; valid ids: RAW, L5, L6, L7");
});

test("Fleet full enumeration remains at expected_runs", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));

  expect(enumerate(config, golden)).toHaveLength(config.expected_runs);
});

test("Fleet --models narrows a wave that shares versions with another wave", async () => {
  // Wave B (RAW+L7 on the two bisect models) and Wave C (RAW+L7 on the other six) share
  // versions, so version filtering alone cannot separate them.
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);
  const versionIds = config.versions.map((version: any) => version.id);
  const modelIds = config.models.map((model: any) => model.id);

  const waveB = selectCells(cells, versionIds, "RAW,L7", undefined, modelIds, "sonnet-5,gpt-5.6-terra");

  expect(waveB).toHaveLength(136);
  expect(waveB.every((cell) => ["RAW", "L7"].includes(cell.version))).toBe(true);
  expect(waveB.every((cell) => ["sonnet-5", "gpt-5.6-terra"].includes(cell.model))).toBe(true);
});

test("Fleet --models rejects an unknown model id", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  expect(() => selectCells(cells, config.versions.map((v: any) => v.id), undefined, undefined,
    config.models.map((m: any) => m.id), "sonnet-5,nope")).toThrow("unknown model id(s): nope");
});
