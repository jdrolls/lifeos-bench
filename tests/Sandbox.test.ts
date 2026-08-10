import { describe, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "../tools/Common.ts";
import { cellHome, configRoot, fakeHome, prepareCellHome, realHome, runCellRoot, runWorkspace, runWorkspaceRoot, sanitizeEnvironment, seatbeltProfile } from "../tools/Sandbox.ts";

const HOME = "/Users/operator";
const OPERATOR_CONFIG = join(HOME, ".claude");

describe("sanitizeEnvironment", () => {
  /**
   * Regression: a cell that merely ran `printenv` was marked `contaminated`, because the
   * inherited PATH carried `<home>/.claude/plugins/cache/.../bin` and LeakCheck matched the
   * literal operator config path in the transcript. No file outside the sandbox was ever read.
   */
  test("drops operator config entries from PATH", () => {
    const path = [
      "/usr/bin",
      join(OPERATOR_CONFIG, "plugins", "cache", "official", "bin"),
      join(HOME, ".bun", "bin"),
    ].join(":");

    const result = sanitizeEnvironment({ PATH: path }, HOME);

    expect(result.PATH).not.toContain(OPERATOR_CONFIG);
    expect(result.PATH?.split(":")).toEqual(["/usr/bin", join(HOME, ".bun", "bin")]);
  });

  test("keeps the toolchain paths the CLI needs to execute", () => {
    const path = [join(HOME, ".bun", "bin"), join(HOME, ".local", "bin")].join(":");

    expect(sanitizeEnvironment({ PATH: path }, HOME).PATH).toBe(path);
  });

  test("drops any other variable pointing into the operator config tree", () => {
    const result = sanitizeEnvironment(
      { PAI_DIR: join(OPERATOR_CONFIG, "PAI"), UNRELATED: "keep-me" },
      HOME,
    );

    expect(result.PAI_DIR).toBeUndefined();
    expect(result.UNRELATED).toBe("keep-me");
  });

  test("leaves the benchmark's own nested .claude sandbox intact", () => {
    // configRoot() ends in `.claude` too; stripping it would break every run.
    const sandbox = configRoot("L6");

    const result = sanitizeEnvironment({ CLAUDE_CONFIG_DIR: sandbox }, HOME);

    expect(result.CLAUDE_CONFIG_DIR).toBe(sandbox);
  });

  test("omits undefined values rather than forwarding them", () => {
    expect("MISSING" in sanitizeEnvironment({ MISSING: undefined }, HOME)).toBe(false);
  });
});

describe("sandbox layout", () => {
  test("config root is physically nested inside the fake home", () => {
    // Upstream tools import via `../../../.claude/...`, which only resolves when the config
    // root really lives at <fakeHome>/.claude rather than being reached through a symlink.
    expect(configRoot("L6")).toBe(join(fakeHome("L6"), ".claude"));
    expect(configRoot("L6").startsWith(fakeHome("L6"))).toBe(true);
  });

  test("seatbelt denies the operator home while allowing the nested config root", () => {
    const home = cellHome("L6", "sonnet-5", "t1-fact", 1);
    const profile = seatbeltProfile({
      home,
      configRoot: join(home, ".claude"),
      workspace: "/tmp/workspace",
      trialDirectory: "/tmp/trial",
    });

    expect(profile).toContain('(deny file-read* (subpath "');
    expect(profile).toContain(`(allow file-read* (subpath "${join(home, ".claude")}")`);
    expect(profile).toContain(`(allow file-write* (subpath "${join(home, ".claude")}")`);
  });

  /**
   * Regression: hooks write runtime state into `$HOME/.claude/...`, so a shared staged home makes
   * cell N's context depend on cell N-1. Measured on the first hooks-on cells: L7 wrote 29 files
   * into the shared tree (`drift-reminder.json`, `work.json`, `review-state.json`, …) and v5's
   * settings hooks rewrote the very `settings.json` every later cell in that lane loads.
   *
   * Cloning the home per cell is the fix; NOT re-allowing the staged tree in the profile is what
   * makes it a boundary instead of a convention.
   */
  test("seatbelt grants the staged template no write access", () => {
    const home = cellHome("L6", "sonnet-5", "t1-fact", 1);
    const profile = seatbeltProfile({
      home,
      configRoot: join(home, ".claude"),
      workspace: "/tmp/workspace",
      trialDirectory: "/tmp/trial",
    });

    expect(profile).not.toContain(`(allow file-write* (subpath "${fakeHome("L6")}")`);
    expect(profile).not.toContain(`(allow file-write* (subpath "${configRoot("L6")}")`);
    // …and the blanket operator-home deny is what actually refuses it, since the staged tree
    // lives under the repo, which lives under that home.
    expect(fakeHome("L6").startsWith(realHome)).toBe(true);
    expect(profile).toContain(`(deny file-write* (subpath "${realHome}"))`);
  });

  test("prepareCellHome clones the staged tree and leaves the template untouched", async () => {
    const staged = fakeHome("L6");
    if (!(await exists(join(staged, ".claude", "settings.json")))) return; // unstaged checkout
    const before = await readFile(join(staged, ".claude", "settings.json"), "utf8");
    const home = await prepareCellHome("L6", "clone-test", "t1-fact", 99);
    try {
      expect(home).not.toBe(staged);
      expect(await exists(join(home, ".claude", "settings.json"))).toBe(true);
      // A hook writing into its HOME must not reach the template every other cell clones.
      await writeFile(join(home, ".claude", "settings.json"), '{"mutated":true}\n');
      expect(await readFile(join(staged, ".claude", "settings.json"), "utf8")).toBe(before);
    } finally {
      await rm(runCellRoot("L6", "clone-test", "t1-fact", 99), { recursive: true, force: true });
    }
  });

  test("each cell gets its own home, outside the operator home", () => {
    const a = cellHome("L6", "sonnet-5", "t1-fact", 1);
    const b = cellHome("L6", "sonnet-5", "t1-fact", 2);
    const c = cellHome("L7", "sonnet-5", "t1-fact", 1);
    expect(new Set([a, b, c]).size).toBe(3);
    for (const home of [a, b, c]) expect(home.startsWith(realHome)).toBe(false);
    // The workspace and the home are siblings under one per-cell root, so cleanup removes both.
    expect(runWorkspace("L6", "sonnet-5", "t1-fact", 1).startsWith(runCellRoot("L6", "sonnet-5", "t1-fact", 1))).toBe(true);
    expect(a.startsWith(runCellRoot("L6", "sonnet-5", "t1-fact", 1))).toBe(true);
  });
});

/**
 * Regression: the cell working directory must live OUTSIDE the operator home.
 *
 * Under the seatbelt, a Bun process whose cwd sits inside the denied home starts with a
 * completely empty `process.env` — 0 variables, while `/usr/bin/env` in the same hook
 * invocation prints 121. Every scaffold hook is `#!/usr/bin/env bun`, so with no PATH the
 * v6 router's `spawn('claude')` failed with `Executable not found in $PATH: "claude"`,
 * fail-safed to NATIVE on every prompt, and the model never entered the Algorithm. That was
 * reported as a scaffold routing result for an entire wave.
 */
describe("runWorkspace", () => {
  test("never sits inside the operator home", () => {
    expect(runWorkspaceRoot().startsWith(realHome)).toBe(false);
    expect(runWorkspace("L6", "sonnet-5", "t1-fact", 1).startsWith(realHome)).toBe(false);
  });

  test("is unique per cell so concurrent cells cannot share a cwd", () => {
    const a = runWorkspace("L6", "sonnet-5", "t1-fact", 1);
    const b = runWorkspace("L6", "sonnet-5", "t1-fact", 2);
    const c = runWorkspace("L7", "sonnet-5", "t1-fact", 1);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
