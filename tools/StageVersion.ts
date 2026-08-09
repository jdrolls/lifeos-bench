import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { arg, copyTree, ensure, exists, files, path, reset } from "./Common.ts";
import { stagePersona } from "./StagePersona.ts";
import { configRoot } from "./Sandbox.ts";

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
// FORK is retained for local experiments behind --fork-src but is no longer part of the
// published matrix: the comparison is upstream LifeOS versions against a bare control.
const versions = new Set(["RAW", "L5", "L6", "L7", "FORK"]);

/** Persona names substituted into each version's install placeholders, as install.sh would. */
const PERSONA_TOKENS: Array<[string, string]> = [
  ["{{PRINCIPAL_NAME}}", "Bruce"],
  ["{PRINCIPAL.NAME}", "Bruce"],
  ["{{DA_NAME}}", "Alfred"],
  ["{DA_IDENTITY.NAME}", "Alfred"],
];

/** Where each upstream release keeps the payload that becomes the Claude config dir. */
const UPSTREAM_PAYLOADS: Record<string, { payload: string[]; user: string[]; template: string | null; systemPromptDir: string }> = {
  // v5.0.0 predates the LifeOS/install layout: the release ships a whole .claude tree, and
  // its CLAUDE.md is already the entrypoint with identity @-imports ACTIVE.
  L5: {
    payload: ["vendor", "LifeOS-v5", "Releases", "v5.0.0", ".claude"],
    user: ["PAI", "USER"],
    template: null,
    systemPromptDir: "PAI",
  },
  L6: {
    payload: ["vendor", "LifeOS-v6", "LifeOS", "install"],
    user: ["LIFEOS", "USER"],
    template: "CLAUDE.template.md",
    systemPromptDir: "LIFEOS",
  },
  L7: {
    payload: ["vendor", "LifeOS", "LifeOS", "install"],
    user: ["LIFEOS", "USER"],
    template: "CLAUDE.template.md",
    systemPromptDir: "LIFEOS",
  },
};
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

/** Substitute the install-time identity placeholders, as each version's install.sh would. */
async function substitutePersonaTokens(destination: string): Promise<void> {
  for (const relativeFile of await files(destination)) {
    if (!/\.(md|json|ts|sh|txt|yaml|yml)$/.test(relativeFile)) continue;
    const candidate = join(destination, relativeFile);
    const content = await readFile(candidate, "utf8").catch(() => undefined);
    if (content === undefined) continue;
    let next = content;
    for (const [from, to] of PERSONA_TOKENS) next = next.split(from).join(to);
    if (next !== content) await writeFile(candidate, next);
  }
}

/**
 * Run the version's OWN import-activation tool rather than reimplementing its rules.
 * v6/v7 ship the identity @-imports commented out, to be activated by the agentic setup
 * once USER is scaffolded. Phases 1-3 skipped this step entirely, so the synthetic profile
 * was staged into a tree that never imported it — which would have floored any
 * personalization measurement for reasons that have nothing to do with the scaffold.
 */
async function activateIdentityImports(destination: string, payload: string): Promise<string[]> {
  const tool = join(payload, "skills", "LifeOS", "Tools", "ActivateImports.ts");
  if (!(await exists(tool))) throw new Error(`upstream ActivateImports tool is missing: ${tool}`);
  const proc = Bun.spawn(["bun", tool, "--config-root", destination, "--apply", "--allow-dev"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`ActivateImports failed (${exitCode}): ${stderr.trim() || stdout.trim()}`);
  const activated = JSON.parse(stdout) as { activated?: string[]; skipped?: string[] };
  if (!activated.activated?.length) {
    throw new Error(`ActivateImports activated nothing; skipped=${JSON.stringify(activated.skipped ?? [])}`);
  }
  return activated.activated;
}

/** Run the upstream hook installer and fail if it leaves the staged config unenforced. */
async function installUpstreamHooks(destination: string, payload: string): Promise<void> {
  const skillRoot = join(payload, "..");
  const tool = join(skillRoot, "Tools", "InstallHooks.ts");
  if (!(await exists(tool))) throw new Error(`upstream InstallHooks tool is missing: ${tool}`);
  const proc = Bun.spawn([
    "bun", tool,
    "--config-root", destination,
    "--skill-root", skillRoot,
    "--apply",
    "--allow-dev",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`InstallHooks failed (${exitCode}): ${stderr.trim() || stdout.trim()}`);

  const settingsFile = join(destination, "settings.json");
  let settings: unknown;
  try {
    settings = JSON.parse(await readFile(settingsFile, "utf8"));
  } catch (error) {
    throw new Error(`InstallHooks produced invalid settings.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hooks = settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).hooks
    : undefined;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks) || Object.keys(hooks).length === 0) {
    throw new Error("InstallHooks registered no hooks in settings.json");
  }
}

/**
 * Stage an upstream LifeOS release into a Claude config directory.
 *
 * Deliberately does NOT @-import the Algorithm. Phases 1-3 appended
 * `@LIFEOS/ALGORITHM/<version>`, which never resolved (LATEST holds "8.17.3"; the file is
 * "v8.17.3.md", and Claude Code does not extension-guess) — so the lane ran with no
 * Algorithm and the model went hunting for one outside its sandbox. Upstream never imports
 * it either: the system prompt instructs an on-demand read, wired via
 * --append-system-prompt-file. The existence assertion below keeps a silent rename loud.
 */
async function stageUpstream(version: string, destination: string): Promise<void> {
  const spec = UPSTREAM_PAYLOADS[version];
  if (!spec) throw new Error(`no upstream payload mapping for ${version}`);
  const payload = path(...spec.payload);
  if (!(await exists(payload))) throw new Error(`upstream payload is missing: ${payload} (vendor the tag first)`);
  await copyTree(payload, destination);

  if (spec.template) {
    // Claude Code reads only settings.json; upstream generates it from settings.system.json,
    // and skipping that setup step ran this scaffold with no enforcement layer.
    const systemSettings = join(destination, "settings.system.json");
    if (!(await exists(systemSettings))) throw new Error(`${version} payload is missing settings.system.json`);
    await cp(systemSettings, join(destination, "settings.json"));

    const template = join(destination, spec.template);
    if (!(await exists(template))) throw new Error(`${version} payload is missing ${spec.template}`);
    await cp(template, join(destination, "CLAUDE.md"));
  }
  if (!(await exists(join(destination, "CLAUDE.md")))) throw new Error(`${version} produced no CLAUDE.md`);

  const algorithmDirectory = join(destination, spec.systemPromptDir, "ALGORITHM");
  const algorithmVersion = (await readFile(join(algorithmDirectory, "LATEST"), "utf8")).trim();
  if (!/^[A-Za-z0-9._-]+$/.test(algorithmVersion)) throw new Error(`${version} algorithm LATEST is invalid`);
  const algorithmCandidates = [join(algorithmDirectory, `v${algorithmVersion}.md`), join(algorithmDirectory, `${algorithmVersion}.md`)];
  let algorithmFound = false;
  for (const candidate of algorithmCandidates) if (await exists(candidate)) algorithmFound = true;
  if (!algorithmFound) throw new Error(`${version} algorithm file is missing for LATEST=${algorithmVersion}`);

  // Replace, never merge: the shipped USER scaffold is template prose, not a profile.
  await rm(join(destination, "USER"), { recursive: true, force: true });
  await stagePersona(join(destination, ...spec.user), version === "L5" ? "v5" : "v67");

  // v5 ships its identity imports already active; v6/v7 need their own setup step.
  if (spec.template) await activateIdentityImports(destination, payload);
  await substitutePersonaTokens(destination);
  if (spec.template) await installUpstreamHooks(destination, payload);
  await assertScrubbed(destination);
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

  const destination = configRoot(version);
  const force = Bun.argv.includes("--force");
  if (await exists(destination) && !force) {
    if (version === "FORK") await assertScrubbed(destination);
    console.log(JSON.stringify({ version, status: "already_staged", sandbox: destination }));
    return;
  }

  await reset(destination);
  try {
    if (version === "RAW") await stageRaw(destination);
    else if (version in UPSTREAM_PAYLOADS) await stageUpstream(version, destination);
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
      const parsed = JSON.parse(settings.split("__SANDBOX_ROOT__").join(destination));
      // The fork enforces a Claude-only model allowlist (enforceAvailableModels), which
      // silently coerces cross-vendor --model args back onto Claude ids. A GPT port must
      // strip this policy guard, so the benchmark sandbox does too; Claude lanes are
      // unaffected (their models were all allowed anyway).
      delete parsed.enforceAvailableModels;
      delete parsed.availableModels;
      delete parsed.fallbackModel;
      await writeFile(settingsFile, `${JSON.stringify(parsed, null, 2)}\n`);
    }
    // …2) auth: NOTHING credential-bearing is placed in the sandbox.
    // Cells run under --permission-mode bypassPermissions, so anything reachable inside the
    // config dir is readable by the model under test and can land verbatim in a published
    // transcript. Claude lanes authenticate purely from CLAUDE_CODE_OAUTH_TOKEN (set by
    // RunCell from sandboxes/_auth/oauth-token, which stays OUTSIDE every sandbox); claudex
    // lanes use the local proxy key. Verified: a cell authenticates with no credentials file
    // present at all. The previous shared-symlink scheme put real OAuth access/refresh
    // material one `cat ~/.claude/.credentials.json` away from the transcript, and a plain
    // `ls -la ~/.claude` was already enough to mark a clean cell "contaminated".
    await writeFile(join(destination, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true }, null, 2)}\n`);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }

  console.log(JSON.stringify({ version, status: "staged", sandbox: destination }));
}

if (import.meta.main) await main();
