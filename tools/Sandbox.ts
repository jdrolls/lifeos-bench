import { homedir } from "node:os";
import { join } from "node:path";
import { chmod } from "node:fs/promises";
import { ensure, exists, path } from "./Common.ts";

/**
 * Run isolation for benchmark cells.
 *
 * Phases 1-3 "isolated" cells with CLAUDE_CONFIG_DIR alone. That swaps the config dir but
 * leaves $HOME pointing at the operator's real home, so the thousands of `~/.claude/...`
 * references inside every scaffold resolved to the operator's live install. Cells read it,
 * and the contents landed in published transcripts.
 *
 * Three mechanisms, in this order, because they solve different problems:
 *
 *   1. HOME redirect  — FIDELITY. `~/.claude/...` must resolve to the STAGED scaffold, so
 *      the version under test behaves the way it does on a real machine.
 *   2. Physical nesting — FIDELITY. Upstream tools import across the config root with paths
 *      such as `../../../.claude/hooks/...`; the config root must therefore physically be
 *      `<fakeHome>/.claude`, not a sibling reached only through HOME or a symlink.
 *   3. Seatbelt       — SAFETY. Anything that still reaches for the real home is refused by
 *      the kernel rather than by good manners.
 *
 * A denied read is NOT a graded outcome: it perturbs behavior (the model errors, retries,
 * improvises). Callers must treat a boundary hit as an invalidated cell — see LeakCheck.
 */

export const realHome = homedir();

/** Version-local HOME used to run a staged config without touching the operator's home. */
export function fakeHome(version: string): string {
  return path("sandboxes", "_home", version);
}

/**
 * The staged Claude config root. It is physically nested under fakeHome because upstream
 * relative imports explicitly traverse through `.claude`, bypassing HOME resolution.
 */
export function configRoot(version: string): string {
  return join(fakeHome(version), ".claude");
}

/**
 * Strip the operator's own config path out of the child environment.
 *
 * The runner inherits `process.env`, whose PATH carries entries like
 * `<realHome>/.claude/plugins/cache/.../bin`. That is contamination twice over: those bins are
 * on the sandboxed scaffold's PATH, and any cell that dumps its environment writes the literal
 * operator config path into its transcript — which LeakCheck then flags as an escape. A cell
 * that merely ran `printenv` got marked `contaminated` and, by design, would have withheld the
 * whole fleet's report. Remove it at the source so the marker cannot appear without a real read.
 *
 * The toolchain paths the CLI genuinely needs (`.bun/bin`, `.local/bin`) are deliberately kept —
 * the seatbelt allows those read-only, and dropping them would break the run.
 */
/**
 * Ephemeral terminal-session shims that must never be what a scaffold resolves `claude` to.
 *
 * claudeBinary() already refuses these for the harness's own invocation ("shims vanish between
 * sessions"), but the scaffolds run their OWN inference by spawning bare `claude` from PATH.
 * A shim there is not a cosmetic difference: v6/v7 route every prompt through an LLM classifier
 * hook, that hook's `claude` call resolved to the shim and failed, the router fail-safed to
 * NATIVE, and the model consequently never entered the Algorithm. It looked exactly like the
 * scaffold choosing not to route — a harness artifact masquerading as the headline finding.
 */
const SESSION_SHIM = /cmux-cli-shims|\/T\/[^/]*-shims?\//;

export function sanitizeEnvironment(
  environment: Record<string, string | undefined>,
  home: string = realHome,
  cliDirectory?: string,
): Record<string, string | undefined> {
  const operatorConfig = join(home, ".claude");
  const sanitized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (key === "PATH") {
      const segments = value
        .split(":")
        .filter((segment) => segment && !segment.startsWith(operatorConfig) && !SESSION_SHIM.test(segment));
      // Scaffolds run their own inference by spawning bare `claude`, so what that name resolves
      // to decides whether their router works at all. Leaving it to inherited PATH ordering is
      // how it broke: it first resolved to an ephemeral session shim, and once that was stripped
      // it resolved to nothing — "Executable not found in $PATH: claude" — which the router
      // reported as a fail-safe to NATIVE, indistinguishable from the scaffold declining to
      // route. Pin the same stable binary claudeBinary() picked for the harness itself.
      if (cliDirectory) segments.unshift(cliDirectory);
      sanitized[key] = segments.join(":");
      continue;
    }
    // Any other variable pointing into the operator's config tree is dropped outright: the
    // sandboxed child has its own HOME and CLAUDE_CONFIG_DIR and never needs the real one.
    if (value.includes(operatorConfig)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

/** Directory holding the sandbox's own `claude`, prepended to PATH for every cell. */
export function cliShimDirectory(version: string): string {
  return join(fakeHome(version), "bin");
}

/**
 * Give each sandbox a real, first-on-PATH `claude` executable.
 *
 * The scaffolds run their own inference by spawning bare `claude`, and that lookup was the single
 * point of failure for their entire routing layer. Inherited PATH first resolved it to an
 * ephemeral session shim; with the shim stripped, the router still reported
 * `Executable not found in $PATH: "claude"` even though `command -v claude` in the very same hook
 * invocation resolved to the real symlink at ~/.local/bin/claude — a spawn-resolution quirk, not
 * a PATH ordering problem. Either way the router fail-safed to NATIVE, which is indistinguishable
 * from a scaffold that chose not to route, and it silently became the benchmark's headline.
 *
 * A plain exec wrapper removes the ambiguity: an ordinary file, in a sandbox-owned directory,
 * that hands off to the exact binary claudeBinary() resolved.
 */
async function writeCliShim(home: string): Promise<void> {
  const directory = join(home, "bin");
  await ensure(directory);
  const shim = join(directory, "claude");
  await Bun.write(shim, `#!/bin/sh\nexec ${JSON.stringify(await claudeBinary())} "$@"\n`);
  await chmod(shim, 0o755);
}

/** The real CLI, not a session-scoped wrapper shim. Shims vanish between sessions. */
export async function claudeBinary(): Promise<string> {
  const candidates = [
    join(realHome, ".local", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    join(realHome, ".claude", "local", "claude"),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("no stable claude binary found; refusing to fall back to a PATH shim");
}

/**
 * Ensure only the fake home's auxiliary directories. The nested config root is staged
 * separately and must never be created, replaced, or recursively removed here.
 */
export async function prepareFakeHome(version: string): Promise<string> {
  const home = fakeHome(version);
  const root = configRoot(version);
  if (!(await exists(root))) {
    throw new Error(`sandbox has not been staged: missing config root ${root}`);
  }
  await writeCliShim(home);
  // Scaffolds and tools also probe these; give them real, writable, sandbox-local homes
  // rather than letting a miss fall through to the operator's directories.
  for (const directory of [".cache", ".config", ".local/share", "Documents"]) {
    await ensure(join(home, directory));
  }
  return home;
}

export type SandboxPaths = {
  fakeHome: string;
  configRoot: string;
  workspace: string;
  trialDirectory: string;
};

/**
 * Seatbelt profile: allow by default, deny the real home, then re-allow the specific
 * subtrees a run legitimately needs. Ordering matters — later rules win, which is what
 * lets the benchmark's own directories live under the denied home.
 */
export function seatbeltProfile(paths: SandboxPaths): string {
  const toolchain = [
    join(realHome, ".bun"),
    join(realHome, ".local", "share", "claude"),
    join(realHome, ".local", "bin"),
    join(realHome, ".local", "state", "claude"),
  ];
  const readWrite = [paths.fakeHome, paths.configRoot, paths.workspace, paths.trialDirectory];
  const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return [
    "(version 1)",
    "(allow default)",
    ";; The operator's home is off limits — this is the boundary Phases 1-3 lacked.",
    `(deny file-read* (subpath ${quote(realHome)}))`,
    `(deny file-write* (subpath ${quote(realHome)}))`,
    ";; Toolchain the CLI itself needs to execute (read-only).",
    ...toolchain.map((directory) => `(allow file-read* (subpath ${quote(directory)}))`),
    ";; The run's own directories.",
    ...readWrite.flatMap((directory) => [
      `(allow file-read* (subpath ${quote(directory)}))`,
      `(allow file-write* (subpath ${quote(directory)}))`,
    ]),
    "",
  ].join("\n");
}

/** Write the profile next to the run's artifacts so a failed cell can be reproduced exactly. */
export async function writeSeatbeltProfile(paths: SandboxPaths): Promise<string> {
  const file = join(paths.trialDirectory, "sandbox.sb");
  await ensure(paths.trialDirectory);
  await Bun.write(file, seatbeltProfile(paths));
  return file;
}
