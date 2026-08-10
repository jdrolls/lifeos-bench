import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { configRoot, fakeHome, realHome, runWorkspace, runWorkspaceRoot, sanitizeEnvironment, seatbeltProfile } from "../tools/Sandbox.ts";

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
    const profile = seatbeltProfile({
      fakeHome: fakeHome("L6"),
      configRoot: configRoot("L6"),
      workspace: "/tmp/workspace",
      trialDirectory: "/tmp/trial",
    });

    expect(profile).toContain('(deny file-read* (subpath "');
    expect(profile).toContain(`(allow file-read* (subpath "${configRoot("L6")}")`);
    expect(profile).toContain(`(allow file-write* (subpath "${configRoot("L6")}")`);
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
