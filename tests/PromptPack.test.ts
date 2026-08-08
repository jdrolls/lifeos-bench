import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPromptPack } from "../tools/PromptPack.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function sandbox(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lifeos-bench-pack-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "docs"));
  return directory;
}

describe("PromptPack", () => {
  test("inlines active imports transitively in import order", async () => {
    const directory = await sandbox();
    await writeFile(join(directory, "CLAUDE.md"), "root instructions\n@docs/first.md\n");
    await writeFile(join(directory, "docs", "first.md"), "first instructions\n@docs/nested.md\n");
    await writeFile(join(directory, "docs", "nested.md"), "nested instructions\n");

    const packed = await renderPromptPack(directory);
    expect(packed).toContain("# CLAUDE.md");
    expect(packed).toContain("# docs/first.md");
    expect(packed).toContain("# docs/nested.md");
    expect(packed.indexOf("root instructions")).toBeLessThan(packed.indexOf("first instructions"));
    expect(packed.indexOf("first instructions")).toBeLessThan(packed.indexOf("nested instructions"));
    expect(packed).not.toContain("@docs/first.md");
  });

  test("fails loudly when an import target is missing", async () => {
    const directory = await sandbox();
    await writeFile(join(directory, "CLAUDE.md"), "@docs/missing.md\n");
    await expect(renderPromptPack(directory)).rejects.toThrow("missing @import target docs/missing.md");
  });
});
