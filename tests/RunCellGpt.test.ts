import { expect, test } from "bun:test";
import { gptMeta } from "../tools/RunCellGpt.ts";

test("GPT runner metadata keeps the RunCell result contract with empty token usage", () => {
  const meta = gptMeta({
    version: "L7-GPT",
    model: "gpt-5.6-terra",
    promptId: "t1-edit",
    trial: 1,
    fixture: "t1-edit",
    status: "success",
    exitCode: 0,
    wallClockMs: 42,
    changedFiles: ["notes/todo.md"],
    baseline: { "notes/todo.md": "abc" },
    finalMessage: "done",
  });

  expect(meta).toMatchObject({
    version: "L7-GPT",
    model: "gpt-5.6-terra",
    prompt_id: "t1-edit",
    trial: 1,
    fixture: "t1-edit",
    status: "success",
    exit_code: 0,
    wall_clock_ms: 42,
    token_usage: {},
    final_message: "done",
    changed_files: ["notes/todo.md"],
    baseline: { "notes/todo.md": "abc" },
  });
});
