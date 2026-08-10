import { join, resolve } from "node:path";
import { arg, files, path, root, text } from "./Common.ts";

/**
 * Boundary detector for benchmark artifacts.
 *
 * The synthetic persona is deliberately disjoint from the operator's real identity, which
 * turns the operator's own identifiers into a tripwire: any occurrence of one inside a run
 * artifact is proof that a cell read outside its sandbox. This is stronger than a single
 * canary file because EVERY cell is a leak test, not just the ones that happen to touch it.
 *
 * Fragments are assembled at runtime so this source file never itself contains the literals
 * it is searching for (the same convention StageVersion.ts uses for its scrub gate).
 */
const REAL_IDENTITY_TOKENS: string[][] = [
  ["Jona", "than"],
  ["Rhoa", "des"],
  // NOT the bare account name: `ls -l` inside the sandbox prints the file owner, so it
  // appears in perfectly contained runs. It still catches escapes through ESCAPE_PATTERNS
  // below, where it is anchored to a private-tree path rather than floating free.
  ["rhds", ".dev"],
  ["jumpin", ".dinner"],
  ["Ralph ", "Trades"],
  ["ralph-", "trades"],
  ["NJust", "ice"],
  // Deliberately NOT included: employer and city names. They are real operator attributes,
  // but they also appear in upstream's own skill documentation as generic examples, so as
  // tokens they produce constant false positives — and a detector that cries wolf gets
  // switched off. High-specificity tokens only.
];

/**
 * Any ABSOLUTE path into a real user home is an escape regardless of whose home it is.
 *
 * Every pattern is anchored to that absolute prefix on purpose. A cell runs with HOME
 * redirected into its own sandbox, so `~/Library/...` or a bare `Library/Application
 * Support/...` fragment CANNOT be an escape — it either resolves inside the sandbox or is
 * just text. And it is frequently just text: upstream ships skill documentation naming
 * Chrome's native-messaging host path, so an unanchored fragment flagged four clean cells
 * whose only sin was reading their own scaffold's docs. The scope note below already made
 * this argument for staged sandboxes; it applies identically to a transcript that QUOTES a
 * staged sandbox, which is what the unanchored form missed.
 *
 * Anchoring loses nothing: reaching the operator's tree from a redirected HOME requires
 * spelling the absolute path, which is exactly what these still catch.
 */
const REAL_HOME = String.raw`/Users/(?!runner\b)[A-Za-z0-9_.-]+/`;
const ESCAPE_PATTERNS: RegExp[] = [
  new RegExp(`${REAL_HOME}\\.claude`),
  new RegExp(`${REAL_HOME}Library/CloudStorage`),
  new RegExp(`${REAL_HOME}Library/Application Support/(Google|Firefox|com\\.apple\\.Safari)`),
  new RegExp(`${REAL_HOME}[^"'\\s,)]*\\.credentials\\.json`),
];

export type Violation = { file: string; kind: "identity" | "escape"; marker: string; line: number };

/**
 * The benchmark repo itself lives under the operator's home, so its own paths contain the
 * operator's username. Those are harness-internal, not escapes — the CLI reports its config
 * location in every init event. Strip them before scanning so the detector stays sharp; a
 * blunt token match here would mark every single cell contaminated and get itself disabled.
 */
const repoRoot = resolve(root);
const repoPaths = new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"'\\s,)]*`, "g");

/**
 * A kernel REFUSAL is evidence the boundary held, not evidence it failed.
 *
 * Cells that build a page launch real Chrome, whose crashpad probes the operator's browser
 * profile. The seatbelt denies it, and the refusal names the path it refused — which the escape
 * patterns then matched, invalidating a cell whose containment worked perfectly. One cell was
 * lost to this (`RAW/gpt-5.6-sol/t4-casual-complex/trial-1`) before a retry cleared it.
 *
 * The exemption is deliberately narrow and safe by construction: it applies only when the SAME
 * line also carries an explicit refusal marker. A successful read cannot produce one, so no real
 * escape can hide behind this — a cell that actually read the operator's Chrome profile writes the
 * path without any "Operation not permitted" beside it, and is still caught.
 *
 * Identity-token hits are NOT exempted. A refused read cannot return the operator's name, so a
 * name appearing next to a denial came from somewhere else and is still a genuine signal.
 */
const DENIAL_MARKERS = /Operation not permitted|Permission denied|EPERM|EACCES|deny\(\d+\)|sandbox(?:-exec)?:|Sandbox: deny/i;

export function isRefusalRecord(line: string): boolean {
  return DENIAL_MARKERS.test(line);
}

function scan(content: string, relativeFile: string): Violation[] {
  const found: Violation[] = [];
  const lines = content.split(/\r?\n/);
  const tokens = REAL_IDENTITY_TOKENS.map((parts) => parts.join(""));
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(repoPaths, "<BENCH>");
    for (const token of tokens) {
      if (line.includes(token)) found.push({ file: relativeFile, kind: "identity", marker: token, line: index + 1 });
    }
    // Escape patterns only — see isRefusalRecord. Identity tokens above stay strict.
    if (!isRefusalRecord(line)) {
      for (const pattern of ESCAPE_PATTERNS) {
        const match = line.match(pattern);
        if (match) found.push({ file: relativeFile, kind: "escape", marker: match[0], line: index + 1 });
      }
    }
  }
  return found;
}

/** Scan a directory of run artifacts. Returns every violation; callers decide severity. */
export async function leakCheck(root: string): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const relativeFile of await files(root)) {
    // Binary and vendored payloads are not run output and would only produce noise.
    if (/node_modules|\.(png|jpg|jpeg|gif|zip|lock)$/.test(relativeFile)) continue;
    // sandbox.sb is harness-generated and necessarily names the real home in its deny rule;
    // scanning it would flag every cell as contaminated by the very thing protecting it.
    if (/(^|\/)sandbox\.sb$/.test(relativeFile)) continue;
    // The fleet's own log embeds each cell's result line verbatim, so scanning it re-reports
    // whatever the per-cell artifacts already reported — under a filename that belongs to no
    // cell. It is harness output, not run output.
    if (/(^|\/)fleet[^/]*\.log$/.test(relativeFile)) continue;
    const content = await text(join(root, relativeFile)).catch(() => undefined);
    if (content === undefined) continue;
    violations.push(...scan(content, relativeFile));
  }
  return violations;
}

/**
 * Scope note: point this at RUN ARTIFACTS (results/), never at a staged sandbox. Vendored
 * scaffolds legitimately reference credential filenames, browser support directories, and
 * example home paths in their own source; flagging those says nothing about containment.
 */
async function main(): Promise<void> {
  const root = arg("--root") ?? path("results");
  const violations = await leakCheck(root);
  const byFile = new Map<string, Violation[]>();
  for (const violation of violations) {
    byFile.set(violation.file, [...(byFile.get(violation.file) ?? []), violation]);
  }
  for (const [file, hits] of byFile) {
    const markers = [...new Set(hits.map((hit) => `${hit.kind}:${hit.marker}`))].join(", ");
    console.log(`${file}: ${markers}`);
  }
  console.log(JSON.stringify({ root, files_scanned: (await files(root)).length, violating_files: byFile.size, violations: violations.length }));
  // Non-zero exit so a fleet wrapper can halt on the first contaminated batch.
  if (violations.length > 0) process.exit(1);
}

if (import.meta.main) await main();
