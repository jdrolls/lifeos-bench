import { expect, test } from "bun:test";

test("the report command prints the paid-sales heading", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/report.ts"],
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Paid sales report");
});
