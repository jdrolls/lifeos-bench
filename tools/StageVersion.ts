import { appendFile, chmod, cp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { arg, copyTree, ensure, exists, files, path, reset } from "./Common.ts";

// Keep the static harness free of private-profile literals while checking the exact
// prohibited values after concatenation in the staged tree.
const forbiddenFragments = [
  ["Jona", "than"].join(""),
  ["Rhoa", "des"].join(""),
  ["rhds", ".dev"].join(""),
  ["jd", "rolls"].join(""),
  ["jumpin", ".dinner"].join(""),
];

// Deterministic identity rewrite for the FORK lane: scaffolding doctrine is kept
// verbatim, personal identifiers become the synthetic "Alex Doe" persona.
const rewriteMap: Array<[string, string]> = [
  [["Jona", "than"].join(""), "Alex"],
  [["Rhoa", "des"].join(""), "Doe"],
  [["rhds", ".dev"].join(""), "bench.example"],
  [["jumpin", ".dinner.rolls@gmail.com"].join(""), "alex@example.com"],
  [["jd", "rolls"].join(""), "alexdoe"],
];
const versions = new Set(["RAW", "L7", "FORK"]);
const sharedAuthDirectory = path("sandboxes", "_auth");

/** Prefer the most recently refreshed credentials file so the shared chain starts valid. */
async function newestCredentialsSeed(): Promise<string | undefined> {
  const candidates = [
    join(homedir(), ".claude", ".credentials.json"),
    ...["RAW", "L7", "FORK"].map((version) => path("sandboxes", version, ".credentials.json")),
  ];
  let newest: { file: string; mtimeMs: number } | undefined;
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (!newest || info.mtimeMs > newest.mtimeMs) newest = { file: candidate, mtimeMs: info.mtimeMs };
  }
  return newest?.file;
}

async function syntheticUserSource(): Promise<string> {
  const fixtureRoot = path("fixtures", "_synthetic-user");
  const nestedUser = join(fixtureRoot, "USER");
  if (await exists(nestedUser)) return nestedUser;
  if (await exists(fixtureRoot)) return fixtureRoot;
  throw new Error("synthetic user fixture is missing at fixtures/_synthetic-user");
}

/** Replace, rather than merge, all user-controlled source material. */
async function overlaySyntheticUser(destination: string): Promise<void> {
  await rm(join(destination, "USER"), { recursive: true, force: true });
  await copyTree(await syntheticUserSource(), join(destination, "USER"));
}

async function assertScrubbed(destination: string): Promise<void> {
  const hits: string[] = [];
  for (const relativeFile of await files(destination)) {
    const candidate = join(destination, relativeFile);
    const content = await readFile(candidate, "utf8").catch(() => undefined);
    if (content === undefined) continue; // Binary assets cannot contain a textual profile marker.
    for (const fragment of forbiddenFragments) {
      if (content.includes(fragment)) hits.push(`${relativeFile}: ${fragment}`);
    }
  }
  if (hits.length > 0) throw new Error(`containment scrub failed:\n${hits.join("\n")}`);
}

async function stageRaw(destination: string): Promise<void> {
  await ensure(destination);
  await writeFile(join(destination, "settings.json"), `${JSON.stringify({
    $schema: "https://json.schemastore.org/claude-code-settings.json",
  }, null, 2)}\n`);
}

async function stageL7(destination: string): Promise<void> {
  // v7.28.3's released config payload is nested beneath LifeOS/install, while the
  // target is the Claude config directory itself. Copy its contents into the target.
  const installPayload = path("vendor", "LifeOS", "LifeOS", "install");
  if (!(await exists(installPayload))) throw new Error(`upstream install payload is missing: ${installPayload}`);
  await copyTree(installPayload, destination);

  const template = join(destination, "CLAUDE.template.md");
  if (!(await exists(template))) throw new Error("upstream install payload is missing CLAUDE.template.md");
  const claudeFile = join(destination, "CLAUDE.md");
  await cp(template, claudeFile);
  // The template imports the architecture summary, but does not activate the
  // algorithm itself. Resolve upstream's declared current algorithm rather than
  // hard-coding a release filename, then make the config-dir entrypoint explicit.
  const algorithmVersion = (await readFile(join(destination, "LIFEOS", "ALGORITHM", "LATEST"), "utf8")).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(algorithmVersion)) throw new Error("upstream algorithm LATEST is invalid");
  await appendFile(claudeFile, `\n@LIFEOS/ALGORITHM/${algorithmVersion}\n`);
  await overlaySyntheticUser(destination);
}

// Scaffolding only — PAI/MEMORY, PAI/USER, agent-runs, PULSE, releases, and .git are
// private/runtime state and never enter a sandbox. hooks/ and settings.json carry the
// fork's deterministic router — without them FORK degrades to CLAUDE.md-only.
const forkAllowlist = [
  "CLAUDE.md",
  "settings.json",
  "hooks",
  "skills",
  "PAI/PAI_SYSTEM_PROMPT.md",
  "PAI/Algorithm",
  "PAI/CONTEXT",
  "PAI/DOCUMENTATION/ARCHITECTURE_SUMMARY.md",
];

async function rewriteIdentity(destination: string): Promise<void> {
  for (const relativeFile of await files(destination)) {
    const candidate = join(destination, relativeFile);
    const content = await readFile(candidate, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    let next = content;
    for (const [from, to] of rewriteMap) next = next.split(from).join(to);
    if (next !== content) await writeFile(candidate, next);
  }
}

async function stageFork(destination: string, source: string): Promise<void> {
  if (!(await exists(source))) throw new Error(`fork source does not exist: ${source}`);
  for (const entry of forkAllowlist) {
    const sourceEntry = join(source, entry);
    if (!(await exists(sourceEntry))) throw new Error(`fork source is missing ${entry}`);
    await copyTree(sourceEntry, join(destination, entry));
  }
  // Fork layout keeps user files at PAI/USER (CLAUDE.md @-imports them from there);
  // the fork-shaped synthetic persona carries exactly the files CLAUDE.md imports.
  const forkUser = path("fixtures", "_synthetic-user-fork");
  if (!(await exists(forkUser))) throw new Error("fixtures/_synthetic-user-fork is missing");
  await rm(join(destination, "PAI", "USER"), { recursive: true, force: true });
  await copyTree(forkUser, join(destination, "PAI", "USER"));
  // Hook registrations reference the live tree by absolute path; neutralize them here so
  // the scrub gate passes, then inject the real absolute sandbox path AFTER the gate (the
  // hooks do NOT expand $VAR syntax in these fields — a literal "$CLAUDE_CONFIG_DIR" dir
  // ends up inside the graded workspace and poisons collateral-edit graders).
  const settingsFile = join(destination, "settings.json");
  const settings = await readFile(settingsFile, "utf8");
  await writeFile(settingsFile, settings.split(join(source)).join("__SANDBOX_ROOT__"));
  // Hooks write observability/session state relative to the config dir at runtime.
  await ensure(join(destination, "PAI", "MEMORY", "OBSERVABILITY"));
  await ensure(join(destination, "PAI", "MEMORY", "WORK"));
  await rewriteIdentity(destination);
  await assertScrubbed(destination);
}

async function main(): Promise<void> {
  const version = Bun.argv[2];
  if (!version || !versions.has(version)) {
    throw new Error("usage: bun tools/StageVersion.ts RAW|L7|FORK [--force] [--fork-src DIR]");
  }

  const destination = path("sandboxes", version);
  const force = Bun.argv.includes("--force");
  if (await exists(destination) && !force) {
    if (version === "FORK") await assertScrubbed(destination);
    console.log(JSON.stringify({ version, status: "already_staged", sandbox: destination }));
    return;
  }

  await reset(destination);
  try {
    if (version === "RAW") await stageRaw(destination);
    else if (version === "L7") await stageL7(destination);
    else {
      const source = arg("--fork-src");
      if (!source) throw new Error("FORK requires --fork-src DIR");
      await stageFork(destination, source);
    }
    // The required containment gate applies to the local fork where source content
    // can be private. L7 is an untouched public upstream payload plus fake user data.
    if (version === "FORK") await assertScrubbed(destination);
    // Post-scrub injections: values that would (correctly) trip the gate but never leave
    // this machine. 1) the sandbox's own absolute path into hook registrations…
    if (version === "FORK") {
      const settingsFile = join(destination, "settings.json");
      const settings = await readFile(settingsFile, "utf8");
      await writeFile(settingsFile, settings.split("__SANDBOX_ROOT__").join(destination));
    }
    // …2) auth: credentials are account-identifying. Sandboxes are gitignored.
    // ALL sandboxes symlink ONE shared credentials file: per-sandbox copies fork the OAuth
    // refresh chain — the first run to refresh rotates the token and orphans every other copy.
    await ensure(sharedAuthDirectory);
    const shared = join(sharedAuthDirectory, ".credentials.json");
    if (!(await exists(shared))) {
      const seed = await newestCredentialsSeed();
      if (!seed) throw new Error("no .credentials.json found to seed sandbox auth");
      await cp(seed, shared);
      await chmod(shared, 0o600);
    }
    const link = join(destination, ".credentials.json");
    await rm(link, { force: true });
    await symlink(shared, link);
    await writeFile(join(destination, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true }, null, 2)}\n`);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }

  console.log(JSON.stringify({ version, status: "staged", sandbox: destination }));
}

if (import.meta.main) await main();
