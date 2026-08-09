import { homedir } from "node:os";
import { join } from "node:path";
import { rm, symlink } from "node:fs/promises";
import { ensure, exists, path } from "./Common.ts";

/**
 * Run isolation for benchmark cells.
 *
 * Phases 1-3 "isolated" cells with CLAUDE_CONFIG_DIR alone. That swaps the config dir but
 * leaves $HOME pointing at the operator's real home, so the thousands of `~/.claude/...`
 * references inside every scaffold resolved to the operator's live install. Cells read it,
 * and the contents landed in published transcripts.
 *
 * Two mechanisms, in this order, because they solve different problems:
 *
 *   1. HOME redirect  — FIDELITY. `~/.claude/...` must resolve to the STAGED scaffold, so
 *      the version under test behaves the way it does on a real machine.
 *   2. Seatbelt       — SAFETY. Anything that still reaches for the real home is refused by
 *      the kernel rather than by good manners.
 *
 * A denied read is NOT a graded outcome: it perturbs behavior (the model errors, retries,
 * improvises). Callers must treat a boundary hit as an invalidated cell — see LeakCheck.
 */

export const realHome = homedir();

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
 * Build the per-version fake home. `<fakeHome>/.claude` points at the staged sandbox so a
 * scaffold's `~/.claude/LIFEOS/...` reference lands inside its own install.
 */
export async function prepareFakeHome(version: string, sandbox: string): Promise<string> {
  const home = path("sandboxes", "_home", version);
  await ensure(home);
  const link = join(home, ".claude");
  await rm(link, { recursive: true, force: true });
  await symlink(sandbox, link);
  // Scaffolds and tools also probe these; give them real, writable, sandbox-local homes
  // rather than letting a miss fall through to the operator's directories.
  for (const directory of [".cache", ".config", ".local/share", "Documents"]) {
    await ensure(join(home, directory));
  }
  return home;
}

export type SandboxPaths = {
  fakeHome: string;
  sandbox: string;
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
  const readWrite = [paths.fakeHome, paths.sandbox, paths.workspace, paths.trialDirectory];
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
