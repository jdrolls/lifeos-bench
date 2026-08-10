import { describe, expect, test } from "bun:test";
import { isCapturedHomeState } from "../tools/RunCell.ts";

/**
 * Regression: the per-cell HOME capture exists to prove a scaffold's hook layer ran. It is
 * evidence, so what it collects has to be the version's own behaviour and nothing else.
 *
 * Both failure directions were observed on the first cell that used it. Too wide: a cell rewrites
 * ~445 files under `.claude/plugins/` per run, which buried the 23 real scaffold writes AND copied
 * a vendored plugin doc quoting `/Users/alice/.claude` into the graded artifact directory — where
 * LeakCheck read it as an escape and marked a clean cell `contaminated`. Too narrow would be worse:
 * a lane whose hooks silently could not start is the exact Phase 4 defect, and it shows up here as
 * an empty capture.
 */
describe("home-state capture", () => {
  test("keeps scaffold runtime state", () => {
    for (const file of [
      ".claude/LIFEOS/MEMORY/OBSERVABILITY/format-gate.jsonl",
      ".claude/LIFEOS/MEMORY/STATE/drift-reminder.json",
      ".claude/PAI/MEMORY/LEARNING/SIGNALS/ratings.jsonl",
      ".claude/settings.json",
      // v6 resolves `$HOME` literally, so its hook state lands in a directory of that name.
      "$HOME/.claude/LIFEOS/MEMORY/STATE/last-response.txt",
    ]) {
      expect(isCapturedHomeState(file)).toBe(true);
    }
  });

  test("drops CLI housekeeping, vendored plugin content and the harness's own shim", () => {
    for (const file of [
      ".claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/references/examples.md",
      ".claude/projects/-tmp-workspace/session.jsonl",
      ".claude/backups/.claude.json.backup.1786383272282",
      ".claude/shell-snapshots/snapshot-zsh-1.sh",
      ".claude/statsig/statsig.cached.evaluations",
      ".cache/anything",
      ".config/anything",
      "Library/Caches/anything",
      "bin/claude",
      ".claude/LIFEOS/node_modules/yaml/package.json",
    ]) {
      expect(isCapturedHomeState(file)).toBe(false);
    }
  });
});
