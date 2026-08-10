import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gradeExpectation, type GradeContext, assistantText, isScaffoldState } from "../tools/Grade.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function context(overrides: Partial<GradeContext> = {}): Promise<GradeContext> {
  const workspace = await mkdtemp(join(tmpdir(), "lifeos-bench-grade-"));
  temporaryDirectories.push(workspace);
  return {
    version: "L7",
    workspace,
    transcript: "",
    meta: { final_message: "answer 80", changed_files: [], token_usage: {} },
    config: {
      versions: [
        { id: "RAW", routing_markers: { heavy: null, light: null } },
        { id: "L7", routing_markers: { heavy: "HEAVY", light: "LIGHT" } },
      ],
    },
    ...overrides,
  };
}

async function status(expectation: Record<string, unknown>, ctx: GradeContext): Promise<string> {
  return (await gradeExpectation(expectation as never, ctx)).status;
}

describe("Grade code graders", () => {
  test("regex grades the final message", async () => {
    expect(await status({ grader: "code:regex", target: "final_message", pattern: "\\b80\\b" }, await context())).toBe("pass");
  });

  test("file_contains and file_not_contains inspect file content", async () => {
    const ctx = await context();
    await writeFile(join(ctx.workspace, "todo.md"), "buy oat milk\n");
    expect(await status({ grader: "code:file_contains", file: "todo.md", pattern: "oat milk" }, ctx)).toBe("pass");
    expect(await status({ grader: "code:file_not_contains", file: "todo.md", pattern: "buy milk" }, ctx)).toBe("pass");
  });

  test("file_exists and file_exists_any locate artifacts", async () => {
    const ctx = await context();
    await writeFile(join(ctx.workspace, "page.html"), "<main />");
    expect(await status({ grader: "code:file_exists", file: "page.html" }, ctx)).toBe("pass");
    expect(await status({ grader: "code:file_exists_any", patterns: ["*.html", "src/*.html"] }, ctx)).toBe("pass");
  });

  test("file_unchanged uses changed-files metadata", async () => {
    const ctx = await context({ meta: { changed_files: ["changed.ts"] } });
    expect(await status({ grader: "code:file_unchanged", file: "untouched.ts" }, ctx)).toBe("pass");
    expect(await status({ grader: "code:file_unchanged", file: "changed.ts" }, ctx)).toBe("fail");
  });

  test("workspace_diff_count enforces the maximum", async () => {
    const ctx = await context({ meta: { changed_files: ["a", "b"] } });
    expect(await status({ grader: "code:workspace_diff_count", max_changed_files: 2 }, ctx)).toBe("pass");
    expect(await status({ grader: "code:workspace_diff_count", max_changed_files: 1 }, ctx)).toBe("fail");
  });

  test("max_tool_calls counts structured stream-json tool uses", async () => {
    const transcript = JSON.stringify({ message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pwd" } }] } });
    const ctx = await context({ transcript });
    expect(await status({ grader: "code:max_tool_calls", max: 1 }, ctx)).toBe("pass");
    expect(await status({ grader: "code:max_tool_calls", max: 0 }, ctx)).toBe("fail");
  });

  test("token_budget reads output token usage", async () => {
    const ctx = await context({ meta: { token_usage: { output_tokens: 400 } } });
    expect(await status({ grader: "code:token_budget", max_output_tokens: 400 }, ctx)).toBe("pass");
    expect(await status({ grader: "code:token_budget", max_output_tokens: 399 }, ctx)).toBe("fail");
  });

  test("command_exit0 executes in the trial workspace", async () => {
    expect(await status({ grader: "code:command_exit0", command: "true" }, await context())).toBe("pass");
    expect(await status({ grader: "code:command_exit0", command: "false" }, await context())).toBe("fail");
  });

  test("command_output compares normalized stdout", async () => {
    expect(await status({ grader: "code:command_output", command: "printf 247", expect_stdout: "247" }, await context())).toBe("pass");
  });

  test("command_output_matches_fixture uses the fixture file", async () => {
    const ctx = await context();
    await writeFile(join(ctx.workspace, "expected.txt"), "expected output\n");
    expect(await status({ grader: "code:command_output_matches_fixture", command: "printf 'expected output\\n'", fixture_file: "expected.txt" }, ctx)).toBe("pass");
  });

  test("transcript_contains_command checks command ordering before first edit", async () => {
    const bash = JSON.stringify({ type: "tool_use", name: "Bash", input: { command: "bun test" } });
    const edit = JSON.stringify({ type: "tool_use", name: "Edit", input: { file_path: "x.ts" } });
    const ctx = await context({ transcript: `${bash}\n${edit}\n` });
    expect(await status({ grader: "code:transcript_contains_command", pattern: "bun test", before_first_edit: true }, ctx)).toBe("pass");
    const late = await context({ transcript: `${edit}\n${bash}\n` });
    expect(await status({ grader: "code:transcript_contains_command", pattern: "bun test", before_first_edit: true }, late)).toBe("fail");
  });

  test("routing matches configured mode and skips null markers", async () => {
    // Routing reads assistant speech, so the marker has to be something the model SAID.
    const said = `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "... LIGHT ..." }] } })}\n`;
    expect(await status({ grader: "code:routing", expect_mode: "light" }, await context({ transcript: said }))).toBe("pass");
    expect(await status({ grader: "code:routing", expect_mode: "light" }, await context({ version: "L7-GPT", transcript: said }))).toBe("pass");
    expect(await status({ grader: "code:routing", expect_mode: "heavy" }, await context({ version: "RAW" }))).toBe("skipped");
  });

  test("routing does not match a marker the model only READ in a file", async () => {
    const read = `${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "template: ... LIGHT ..." }] } })}\n`;
    expect(await status({ grader: "code:routing", expect_mode: "light" }, await context({ transcript: read }))).toBe("fail");
  });

  test("judge rubrics are retained as pending rows", async () => {
    expect(await status({ grader: "judge:rubric", rubric: "quality" }, await context())).toBe("pending_judge");
  });
});

import { test as t2, expect as e2 } from "bun:test";
import { compileForTest } from "../tools/Grade.ts";

t2("inline (?i) flag compiles and matches case-insensitively", () => {
  e2(compileForTest("(?i)march").test("March had the highest")).toBe(true);
  e2(compileForTest("(?i)march").test("no month here")).toBe(false);
});

t2("invalid regex surfaces as thrown error, not silent fail", () => {
  e2(() => compileForTest("(?bad)x")).toThrow();
});

test("routing markers are matched against assistant speech, not files the model read", async () => {
  // A heavy prompt is SUPPOSED to read the Algorithm file, which contains banner examples.
  // Matching the raw transcript would score that as correct routing.
  const transcript = [
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "♻︎ Entering the PAI ALGORITHM… (v6.3.0)" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Port 80." }] } }),
  ].join("\n");
  expect(assistantText(transcript)).toBe("Port 80.");
  expect(assistantText(transcript)).not.toContain("ALGORITHM");

  const emitted = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "♻︎ Entering the PAI ALGORITHM… (v6.3.0)" }] } });
  expect(assistantText(emitted)).toContain("ALGORITHM");
});

describe("scaffold state is not the model's work product", () => {
  /**
   * Regression: L7 obeyed a plan-only prompt but was failed on `plan_means_stop`, because its
   * hooks wrote drift/ISA/skill-index JSON into a workspace-local `.claude/`. Only scaffolded
   * versions can be penalised this way, so the metric silently favoured the bare control.
   */
  test("isScaffoldState identifies workspace-local scaffold bookkeeping", () => {
    expect(isScaffoldState(".claude/LIFEOS/MEMORY/STATE/drift-reminder.json")).toBe(true);
    expect(isScaffoldState(".claude/LIFEOS/MEMORY/STATE/isa-nudge/abc.json")).toBe(true);
    expect(isScaffoldState("nested/.claude/PAI/MEMORY/STATE/x.json")).toBe(true);
  });

  /**
   * Regression: once the hooks could actually run (the empty-Bun-environment fix), v6/v7 cells
   * started creating a literal `$HOME` directory in the workspace — settings.json declares
   * `LIFEOS_DIR="$HOME/.claude/LIFEOS"` and Claude Code does not expand `$VAR` in that block.
   * It is hook bookkeeping, and counting it would re-open the one-directional bias above,
   * since only versions WITH hooks can produce it.
   */
  test("isScaffoldState identifies the unexpanded $HOME directory", () => {
    expect(isScaffoldState("$HOME/.claude/LIFEOS/MEMORY/STATE/instruction-hashes.json")).toBe(true);
    expect(isScaffoldState("$HOME/Documents/scratch.json")).toBe(true);
    expect(isScaffoldState("${HOME}/.claude/x.json")).toBe(true);
    // A real file that merely starts with the same letters is not scaffold state.
    expect(isScaffoldState("HOME/readme.md")).toBe(false);
  });

  test("isScaffoldState leaves real work product alone", () => {
    expect(isScaffoldState("src/index.ts")).toBe(false);
    expect(isScaffoldState("notes/todo.md")).toBe(false);
    // A file merely mentioning the name is not scaffold state.
    expect(isScaffoldState("docs/claude-notes.md")).toBe(false);
    expect(isScaffoldState(42)).toBe(false);
  });
});
