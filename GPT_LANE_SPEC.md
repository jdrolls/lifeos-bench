# Slice D — GPT prompt-only lanes (RAW-GPT, L7-GPT)

Read SPEC.md for repo context. The GPT lane measures LifeOS as *prompt scaffolding only*
(no hooks fire on non-Claude harnesses — exactly what GPT-lane LifeOS users get).
Do NOT modify goldenset files, existing graders' semantics, or the claude-engine path.

## Deliverables

### 1. `tools/PromptPack.ts`
`bun tools/PromptPack.ts L7` → writes `sandboxes/L7/promptpack.md`: the L7 sandbox's
CLAUDE.md with every `@import` it references inlined (read from the sandbox tree),
concatenated in import order, with a one-line header naming each section. `RAW` →
writes an empty pack. Fails loud on a missing import target.

### 2. `tools/RunCellGpt.ts`
Same CLI contract as RunCell.ts (`--version --model --prompt --trial`) but executes via
codex: composes `<promptpack>\n\n# Task\n<prompt text>` into a prompt file inside a fresh
workspace (fixtures copied exactly like RunCell), then invokes the wrapper command given
by the `CODEX_RUN_CMD` env template (contains `{promptfile}` and `{workspace}`), captures
stdout to transcript.txt, writes the same meta.json shape (status/exit/wall-clock;
token_usage may be empty), workspace-diff.txt via the same git-diff helper (extract shared
helpers into Common.ts rather than duplicating), then calls gradeTrial. Routing graders
read the transcript exactly like the claude engine — banners are part of the prompt
contract and a compliant GPT run should emit them.

### 3. Config + Fleet
Extend bench.config.json (READ it, then edit minimally): add
`"gpt_models": [{ "id": "gpt-5.6-terra", "versions": ["RAW", "L7"] }]` and teach
Fleet.ts to enumerate gpt cells (version × gpt_model × prompt × same trial counts),
dispatching to RunCellGpt. `--dry-run` total must become 216 + 48 = 264. Resume-safe
identically (results/phase1/RAW-GPT/... and results/phase1/L7-GPT/... — suffix the
version id with "-GPT" in the results path and grade rows so lanes stay distinct).

### 4. Tests
Unit tests: PromptPack inlining (nested import, missing import fails loud), RunCellGpt
meta shape, Fleet enumeration count 264. `bun test` green at root.

## Acceptance (run + paste output)
1. `bun tools/PromptPack.ts L7 && wc -c sandboxes/L7/promptpack.md` (nonzero, includes ALGORITHM content).
2. `bun tools/Fleet.ts --dry-run | wc -l` → 264.
3. `bun test` green.
Do NOT execute live gpt cells — the orchestrator smoke-tests with real CODEX_RUN_CMD.
