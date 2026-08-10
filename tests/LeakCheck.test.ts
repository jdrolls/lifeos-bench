import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRefusalRecord, leakCheck } from "../tools/LeakCheck.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function artifactDir(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "leakcheck-"));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, name);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return directory;
}

describe("escape detection", () => {
  /**
   * The boundary is only crossable by spelling an absolute path: HOME is redirected into the
   * sandbox, so `~/...` resolves inside it. These must keep firing.
   */
  test("flags an absolute read into another user's config tree", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": `{"tool":"Read","path":"/Users/someone/.claude/ALGORITHM/LATEST"}`,
    });

    const violations = await leakCheck(directory);

    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("escape");
  });

  test("flags an absolute read of browser support data", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": `{"cmd":"cat /Users/someone/Library/Application Support/Google/Chrome/Default"}`,
    });

    expect(await leakCheck(directory)).toHaveLength(1);
  });

  test("flags an absolute read of a credentials file", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": `{"cmd":"cat /Users/someone/.config/app/.credentials.json"}`,
    });

    expect(await leakCheck(directory)).toHaveLength(1);
  });
});

describe("false positives that previously failed clean cells", () => {
  /**
   * Regression: upstream ships an Interceptor skill whose docs name Chrome's native-messaging
   * host path. Four contained cells read their OWN scaffold's documentation and were marked
   * `contaminated`, which withheld the whole fleet's report.
   */
  test("ignores a tilde-form browser path quoted from scaffold documentation", async () => {
    const directory = await artifactDir({
      "transcript.jsonl":
        `{"content":"jq '.path=\\"/opt/homebrew/bin/interceptor-daemon\\"' over ` +
        `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.interceptor.host.json"}`,
    });

    expect(await leakCheck(directory)).toEqual([]);
  });

  test("ignores a bare browser-support fragment with no home prefix", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": `{"content":"the manifest lives under Library/Application Support/Google/Chrome"}`,
    });

    expect(await leakCheck(directory)).toEqual([]);
  });

  test("ignores a bare credentials filename in a directory listing", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": `{"content":"lrwxr-xr-x  1 user staff  75 .credentials.json -> ../_auth/.credentials.json"}`,
    });

    expect(await leakCheck(directory)).toEqual([]);
  });

  test("skips the fleet's own log, which re-embeds every cell result", async () => {
    const directory = await artifactDir({
      "fleet.log": `{"result":"read /Users/someone/.claude/ALGORITHM/LATEST"}`,
    });

    expect(await leakCheck(directory)).toEqual([]);
  });

  test("skips the harness-generated seatbelt profile that names the denied home", async () => {
    const directory = await artifactDir({
      "sandbox.sb": `(deny file-read* (subpath "/Users/someone/.claude"))`,
    });

    expect(await leakCheck(directory)).toEqual([]);
  });
});

/**
 * Regression: a refused read is proof the boundary held. Chrome's crashpad probes the operator's
 * browser profile, the seatbelt denies it, and the refusal names the path it refused — which
 * invalidated a cell whose containment worked (RAW/gpt-5.6-sol/t4-casual-complex/trial-1).
 *
 * The exemption must stay narrow: only a line carrying an explicit refusal marker is exempt, and
 * only for escape patterns. A successful read produces no refusal marker, so nothing can hide.
 */
describe("refusal records", () => {
  test("a denied operator-profile read is not an escape", async () => {
    const directory = await artifactDir({
      "stderr.txt": "sandbox-exec: deny(1) file-read-data /Users/operator/Library/Application Support/Google/Chrome/Default\n",
    });
    expect(await leakCheck(directory)).toEqual([]);
  });

  test("the same path without a refusal marker is still an escape", async () => {
    const directory = await artifactDir({
      "transcript.jsonl": '{"text":"read /Users/operator/Library/Application Support/Google/Chrome/Default/Cookies"}\n',
    });
    const violations = await leakCheck(directory);
    expect(violations.length).toBe(1);
    expect(violations[0].kind).toBe("escape");
  });

  test("identity tokens are never exempted by a refusal marker", () => {
    const line = `Operation not permitted: /Users/x/${["Jona", "than"].join("")}`;
    expect(isRefusalRecord(line)).toBe(true);
  });
});
