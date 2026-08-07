# Continuation slice B — build all fixtures (current dirs are EMPTY SHELLS)

Read SPEC.md section 6 for the full fixture contract. Only `t1-edit` has real content.
Build every other fixture exactly as specified. Do NOT touch `tools/`, `goldenset/`,
`bench.config.json`, or root package.json.

Precision requirements (the golden set asserts EXACT values — verify each yourself and
paste the command output in your report):
- `t2-bugfix`: `cd fixtures/t2-bugfix && bun test` → FAILS on the off-by-one; fixing
  src/paginate.ts (not the test) makes it pass. Include the test file the stub omitted.
- `t2-script`: `find fixtures/t2-script/docs -name '*.md' | xargs wc -l` → total exactly 247.
- `t2-csv`: March must be the max month with total exactly 48720.
- `t3-debug`: `bun test` fails deterministically (no flaky timing); minimal fix is one file.
- `t3-refactor`: `bun run src/report.ts > /tmp/x && diff /tmp/x expected_output.txt` → clean,
  and its existing test is green pre-refactor.
- `t4-ambiguous`: one failing test, obvious single bug in src/.
- `t4-multi`: name "foldx" in package.json, README.md, two source files, one string constant;
  `bun test` green.
- `t3-build`, `t3-plan`, `t4-casual-complex`: per SPEC.md.
- `_synthetic-user/`: fake "Alex Doe" TELOS/identity files, zero real personal data.

Acceptance: a table in your report — fixture id → verification command → observed output —
covering every fixture above.
