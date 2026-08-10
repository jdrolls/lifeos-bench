import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chmod, rm } from "node:fs/promises";
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

/**
 * The version's STAGED home — a template, not a run directory.
 *
 * Every cell gets its own clone of this tree (see cellHome). The distinction is load-bearing:
 * scaffold hooks write runtime state into `$HOME/.claude/...`, so a shared home makes cell N's
 * context depend on what cell N-1 left behind.
 */
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
export function cliShimDirectory(home: string): string {
  return join(home, "bin");
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
 * Give this cell a private clone of the staged home.
 *
 * The staged tree is a TEMPLATE. Sharing it across cells was safe only while the hook layer was
 * dead; the moment hooks ran, they wrote their runtime state straight back into it. Measured on
 * the first hooks-on cells: L7 wrote 29 files under `<staged>/.claude/LIFEOS/` — including
 * `drift-reminder.json`, `work.json`, `review-state.json` and `session-names.json`, all of which
 * feed the NEXT session's context — and v5's settings hooks rewrote `<staged>/.claude/settings.json`
 * itself, the file every later cell in that lane loads.
 *
 * That is cross-cell coupling in the only direction that matters: cell N's prompt context depends
 * on what cell N-1 left behind, and under concurrency they race for the same files. It also
 * falsified the independence claim `bench.config.json` makes to justify `concurrency > 1`
 * ("the staged config root is not written at runtime").
 *
 * The versions differ in HOW they land, which is why this was invisible: v6 resolves
 * `LIFEOS_DIR="$HOME/..."` literally and drops a `$HOME/` directory into the cwd (per-cell, inert),
 * while v7 patched that expansion (#1404) and therefore writes to the REAL home — the shared one.
 * Isolating the home fixes both without caring which of them a future version does.
 *
 * Clone, don't symlink: hooks must be able to write, and `cp -c` on APFS is a copy-on-write clone
 * (~0.5s for a 26MB / 3000-file tree, no additional disk).
 */
export async function prepareCellHome(
  version: string,
  model: string,
  promptId: string,
  trial: number,
): Promise<string> {
  const staged = fakeHome(version);
  const stagedRoot = configRoot(version);
  if (!(await exists(stagedRoot))) {
    throw new Error(`sandbox has not been staged: missing config root ${stagedRoot}`);
  }
  const home = cellHome(version, model, promptId, trial);
  await rm(home, { recursive: true, force: true });
  await ensure(join(home, ".."));
  // -c requests an APFS clone and falls back to a real copy on filesystems without it.
  const copy = Bun.spawnSync(["cp", "-Rc", staged, home]);
  if (copy.exitCode !== 0) {
    const detail = new TextDecoder().decode(copy.stderr).trim();
    throw new Error(`failed to clone staged home for ${version}: ${detail}`);
  }
  if (!(await exists(join(home, ".claude")))) {
    throw new Error(`cloned home is missing its config root: ${join(home, ".claude")}`);
  }
  await writeCliShim(home);
  // Scaffolds and tools also probe these; give them real, writable, sandbox-local homes
  // rather than letting a miss fall through to the operator's directories.
  for (const directory of [".cache", ".config", ".local/share", "Documents"]) {
    await ensure(join(home, directory));
  }
  return home;
}

/**
 * Where a cell's working directory physically lives — deliberately OUTSIDE the operator home.
 *
 * This is not tidiness; it is what makes the scaffolds' hooks work at all.
 *
 * Every LifeOS hook is `#!/usr/bin/env bun`. Under the seatbelt, a Bun process whose cwd sits
 * inside the denied `realHome` subtree starts with a COMPLETELY EMPTY `process.env` — measured
 * from inside the hook: `Object.keys(process.env).length === 0`, while `/usr/bin/env` in the very
 * same hook invocation prints 121 variables. Bun reads something under the home during startup,
 * the read is refused, and it silently yields an empty environment rather than failing.
 *
 * The consequence was the benchmark's headline routing result: with no PATH, v6's router hook
 * `spawn('claude')`s into `Executable not found in $PATH: "claude"`, fail-safes to NATIVE on every
 * prompt, and the model never enters the Algorithm. That looked exactly like a scaffold choosing
 * not to route.
 *
 * cwd is the whole trigger — `HOME`, the config root and the staged install may all stay inside the
 * repo. Same seatbelt profile, same environment, cwd under `/private/tmp`: 119 variables. So the
 * fix is to run cells somewhere with no denied ancestors, and copy the workspace back afterwards.
 * The boundary is unchanged (the operator home stays denied); only the cwd moves.
 */
export function runWorkspaceRoot(): string {
  const temporary = tmpdir();
  // A TMPDIR inside the operator home would reintroduce the exact denial this avoids.
  const base = temporary.startsWith(realHome) ? "/tmp" : temporary;
  return join(base, "lifeos-bench-cells");
}

/** Everything one cell runs against: its workspace and its private HOME, both outside the repo. */
export function runCellRoot(version: string, model: string, promptId: string, trial: number): string {
  return join(runWorkspaceRoot(), version, model, promptId, `trial-${trial}`);
}

/** Per-cell working directory outside the denied home. Unique per cell so concurrency is safe. */
export function runWorkspace(version: string, model: string, promptId: string, trial: number): string {
  return join(runCellRoot(version, model, promptId, trial), "workspace");
}

/**
 * Per-cell HOME. Unique per cell for the same reason the workspace is, and outside the operator
 * home for the same reason the cwd is (a Bun process under the denied tree loses its environment).
 */
export function cellHome(version: string, model: string, promptId: string, trial: number): string {
  return join(runCellRoot(version, model, promptId, trial), "home");
}

export type SandboxPaths = {
  /** The cell's OWN home (a clone), never the shared staged template. */
  home: string;
  configRoot: string;
  workspace: string;
  trialDirectory: string;
};

/**
 * Seatbelt profile: allow by default, deny the real home, then re-allow the specific
 * subtrees a run legitimately needs. Ordering matters — later rules win, which is what
 * lets the benchmark's own directories live under the denied home.
 *
 * The staged home under `sandboxes/_home/` is deliberately NOT re-allowed. Cloning it before the
 * cell starts means nothing inside the sandbox has any reason to touch it, so leaving it under the
 * blanket home deny turns "cells must not mutate the staged install" from a convention into a
 * kernel-enforced boundary — the same reason the operator home is denied rather than avoided.
 */
export function seatbeltProfile(paths: SandboxPaths): string {
  const toolchain = [
    join(realHome, ".bun"),
    join(realHome, ".local", "share", "claude"),
    join(realHome, ".local", "bin"),
    join(realHome, ".local", "state", "claude"),
  ];
  const readWrite = [paths.home, paths.configRoot, paths.workspace, paths.trialDirectory];
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
