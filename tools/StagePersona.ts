import { join } from "node:path";
import { ensure, exists, path, reset, text } from "./Common.ts";

/**
 * One persona, three layouts. Each LifeOS generation names the identity files
 * differently; the CONTENT must stay byte-identical across them or a cross-version
 * personalization comparison measures the fixture, not the scaffold.
 */
export type Layout = "fork" | "v5" | "v67";

const BLOCKS = ["principal", "da", "telos", "projects", "operational_rules"] as const;
type Block = (typeof BLOCKS)[number];

/** Destination path for each content block, per layout. A null means the layout has no home for it. */
const LAYOUTS: Record<Layout, Record<Block, string | null>> = {
  // Fork keeps user files flat under PAI/USER; CLAUDE.md @-imports these four directly.
  fork: {
    principal: "PRINCIPAL_IDENTITY.md",
    da: "DA_IDENTITY.md",
    telos: "TELOS/PRINCIPAL_TELOS.md",
    projects: "PROJECTS/PROJECTS.md",
    operational_rules: null, // v5-era CLAUDE.md carries operational rules inline
  },
  // v5.0.0 ships the same four active @-imports under PAI/USER.
  v5: {
    principal: "PRINCIPAL_IDENTITY.md",
    da: "DA_IDENTITY.md",
    telos: "TELOS/PRINCIPAL_TELOS.md",
    projects: "PROJECTS/PROJECTS.md",
    operational_rules: null,
  },
  // v6.0.5 and v7.28.3 both nest by role under LIFEOS/USER and add OPERATIONAL_RULES.
  v67: {
    principal: "PRINCIPAL/PRINCIPAL_IDENTITY.md",
    da: "DIGITAL_ASSISTANT/DA_IDENTITY.md",
    telos: "TELOS/PRINCIPAL_TELOS.md",
    projects: "PROJECTS.md",
    operational_rules: "CONFIG/OPERATIONAL_RULES.md",
  },
};

async function block(name: Block): Promise<string> {
  const file = path("fixtures", "_persona", "blocks", `${name}.md`);
  if (!(await exists(file))) throw new Error(`persona block is missing: ${file}`);
  return text(file);
}

/** Render the persona into `destination` using the given layout. Replaces, never merges. */
export async function stagePersona(destination: string, layout: Layout): Promise<string[]> {
  const mapping = LAYOUTS[layout];
  if (!mapping) throw new Error(`unknown persona layout: ${layout}`);
  await reset(destination);
  const written: string[] = [];
  for (const name of BLOCKS) {
    const relative = mapping[name];
    if (relative === null) continue;
    const target = join(destination, relative);
    await ensure(join(target, ".."));
    await Bun.write(target, await block(name));
    written.push(relative);
  }
  return written.sort();
}

async function main(): Promise<void> {
  const layout = Bun.argv[2] as Layout | undefined;
  const destination = Bun.argv[3];
  if (!layout || !destination || !(layout in LAYOUTS)) {
    throw new Error("usage: bun tools/StagePersona.ts fork|v5|v67 DESTINATION_DIR");
  }
  const written = await stagePersona(destination, layout);
  console.log(JSON.stringify({ layout, destination, written }));
}

if (import.meta.main) await main();
