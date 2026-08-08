import { expect, test } from "bun:test";
import { enumerate } from "../tools/Fleet.ts";
import { json, path } from "../tools/Common.ts";

test("Fleet enumerates the 216 Claude and 48 GPT prompt-only cells", async () => {
  const config = await json<any>(path("bench.config.json"));
  const golden = await json<any>(path("goldenset", "goldenset.json"));
  const cells = enumerate(config, golden);

  expect(cells).toHaveLength(264);
  expect(cells.filter((cell) => cell.engine === "claude")).toHaveLength(216);
  expect(cells.filter((cell) => cell.engine === "gpt")).toHaveLength(48);
  expect(cells.filter((cell) => cell.engine === "gpt").every((cell) => ["RAW", "L7"].includes(cell.version))).toBe(true);
});
