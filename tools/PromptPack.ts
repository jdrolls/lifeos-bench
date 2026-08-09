import { dirname, join, relative } from "node:path";
import { arg, ensure, exists, text } from "./Common.ts";
import { configRoot } from "./Sandbox.ts";

const IMPORT_LINE = /^\s*@([^\s]+)\s*$/gm;

function importCandidates(sandbox: string, target: string): string[] {
  if (!target || target.startsWith("/") || target.split("/").includes("..")) {
    throw new Error(`unsafe @import target: ${target}`);
  }
  const exact = join(sandbox, target);
  const candidates = [exact, `${exact}.md`];
  // LifeOS version imports conventionally omit both the v-prefix and .md extension.
  const name = target.split("/").at(-1) ?? "";
  if (/^\d+(?:\.\d+)+$/.test(name)) candidates.push(join(dirname(exact), `v${name}.md`));
  return [...new Set(candidates)];
}

async function resolveImport(sandbox: string, target: string): Promise<string> {
  for (const candidate of importCandidates(sandbox, target)) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`missing @import target ${target} in ${sandbox}`);
}

/** Render a sandbox CLAUDE.md and all active, transitive @-imports as one prompt document. */
export async function renderPromptPack(sandbox: string): Promise<string> {
  const claude = join(sandbox, "CLAUDE.md");
  if (!(await exists(claude))) throw new Error(`missing sandbox CLAUDE.md: ${claude}`);

  const active = new Set<string>();
  const included = new Set<string>();
  const sections: string[] = [];

  const inline = async (file: string): Promise<void> => {
    const normalized = file;
    if (active.has(normalized)) throw new Error(`cyclic @import: ${relative(sandbox, file)}`);
    // An import can be mentioned more than once; one copy is enough in the prompt pack.
    if (included.has(normalized)) return;
    active.add(normalized);
    included.add(normalized);

    const source = await text(file);
    const imports: Array<{ target: string; index: number; length: number }> = [];
    for (const match of source.matchAll(IMPORT_LINE)) {
      imports.push({ target: match[1], index: match.index ?? 0, length: match[0].length });
    }

    let cursor = 0;
    let section = `# ${relative(sandbox, file) || "CLAUDE.md"}\n`;
    for (const imported of imports) {
      section += source.slice(cursor, imported.index);
      cursor = imported.index + imported.length;
    }
    section += source.slice(cursor);
    sections.push(section.trimEnd());

    for (const imported of imports) await inline(await resolveImport(sandbox, imported.target));
    active.delete(normalized);
  };

  await inline(claude);
  return `${sections.join("\n\n")}\n`;
}

export async function writePromptPack(version: string): Promise<string> {
  const sandbox = configRoot(version);
  if (!(await exists(sandbox))) throw new Error(`sandbox has not been staged: ${sandbox}`);
  const output = join(sandbox, "promptpack.md");
  await ensure(sandbox);
  const content = version === "RAW" ? "" : await renderPromptPack(sandbox);
  await Bun.write(output, content);
  return output;
}

async function main(): Promise<void> {
  const version = Bun.argv[2] ?? arg("--version");
  if (!version) throw new Error("usage: bun tools/PromptPack.ts VERSION");
  const output = await writePromptPack(version);
  console.log(output);
}

if (import.meta.main) await main();
