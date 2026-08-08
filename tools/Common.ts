import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export const root = import.meta.dir + "/..";
export const path = (...parts: string[]) => join(root, ...parts);
export async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
export async function ensure(dir: string) { await mkdir(dir, { recursive: true }); }
export async function reset(dir: string) { await rm(dir, { recursive: true, force: true }); await ensure(dir); }
export async function copyTree(from: string, to: string) { await ensure(join(to, "..")); await cp(from, to, { recursive: true, force: true, dereference: false }); }
export async function exists(file: string) { try { await stat(file); return true; } catch { return false; } }
export async function text(file: string) { return readFile(file, "utf8"); }
export async function writeJson(file: string, value: unknown) { await ensure(join(file, "..")); await writeFile(file, JSON.stringify(value, null, 2) + "\n"); }
export async function files(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const output: string[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full); else if (entry.isFile()) output.push(relative(dir, full));
    }
  }
  await walk(dir); return output.sort();
}
export async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const file of await files(dir)) out[file] = Bun.hash(await readFile(join(dir, file))).toString(16);
  return out;
}
export function changed(before: Record<string, string>, after: Record<string, string>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => before[key] !== after[key]).sort();
}
export function arg(name: string): string | undefined { const i = Bun.argv.indexOf(name); return i < 0 ? undefined : Bun.argv[i + 1]; }

/**
 * Produce a git-style tree diff without requiring either directory to be a repository.
 * `git diff --no-index` returns 1 when it found changes, which is a successful outcome here.
 */
export async function gitWorkspaceDiff(before: string, after: string): Promise<{ diff: string; error?: string }> {
  try {
    const proc = Bun.spawn(["git", "diff", "--no-index", "--no-ext-diff", "--", before, after], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode === 0 || exitCode === 1) return { diff: stdout || "No workspace changes\n" };
    return { diff: stdout || "", error: `git diff failed with exit ${exitCode}: ${stderr.trim()}` };
  } catch (error) {
    return { diff: "", error: `git diff could not launch: ${error instanceof Error ? error.message : String(error)}` };
  }
}
