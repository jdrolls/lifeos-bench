# Phase 4 Plan — Version Bisect + Personalization Tier

Self-contained execution plan. A fresh session should be able to run this end-to-end with no
prior conversation context. **Nothing here has been run yet.**

Current state (as of 2026-08-09): 432 runs complete across RAW / L7 / FORK × Fable 5, Sonnet 5,
Haiku 4.5, GPT-5.6 terra/luna/sol. Results in `results/phase1/REPORT.md`. Golden set v1.0.0 frozen.

---

## Phase 4a — Version bisect: LifeOS v5.0.0 and v6.0.5

**Question answered:** the original #1715 complaint — did v7 regress against earlier versions?
Same frozen prompts, same graders, older scaffolds.

### Build steps (do in order)

1. **Vendor the tags:**
   `git clone --depth 1 --branch v5.0.0 https://github.com/danielmiessler/LifeOS vendor/LifeOS-v5`
   and same for `v6.0.5` → `vendor/LifeOS-v6`.
2. **Inspect each tag's install layout before writing staging code.** They predate v7's
   `LifeOS/install/` payload shape — find where CLAUDE.md-equivalent, algorithm files, and the
   user-profile directory live in each. Do not assume; read the trees.
3. **Extend `tools/StageVersion.ts`** with `L5` and `L6` cases mirroring `stageL7`: copy payload
   into sandbox config-dir shape, overlay `fixtures/_synthetic-user/` in the layout that version
   expects (create per-version synthetic overlays if the file names differ — same Alex Doe facts).
4. **Routing markers:** grep each version's doctrine for its mode/Algorithm banner strings and add
   `routing_markers` entries to the new config version blocks. If a version has no light/heavy mode
   split, set the missing marker to `null` (grader auto-skips) and note it in the README.
5. **Config:** add version blocks `L5` and `L6` (`publish_transcripts: true`). Restrict the bisect
   to two models by leaving `models` as-is — Fleet crosses everything, so instead add a
   per-version `models_allowlist: ["fable-5","sonnet-5"]` field and teach `Fleet.ts` to honor it
   (small change; add a unit test asserting the enumeration count). New `expected_runs`: 432 + 96 = **528**.
6. **Known hazards from Phases 1–3** (all hit before, all have fixes in git history):
   - Old configs may pin era-specific Claude model ids → check for allowlist/enforcement fields and
     model pins during staging inspection; strip or map like FORK's `enforceAvailableModels` was.
   - Auth: Claude lanes need `sandboxes/_auth/oauth-token` present (long-lived setup-token; see README
     runner notes). Never copy `.credentials.json` per sandbox — refresh-chain rotation breaks siblings.
   - Sandboxes are gitignored; scrub gate only applies to FORK.

### Run steps

1. `bun tools/StageVersion.ts L5 --force` / `L6 --force`; then **smoke one cell each**
   (`RunCell --version L5 --model fable-5 --prompt t1-fact --trial 1`) before fleet launch.
2. `bun tools/Fleet.ts --dry-run | wc -l` must print 528.
3. Launch via `tools/fleet-overnight.sh` (resume-safe; 96 new cells, concurrency 2).
4. Judge pass: `JUDGE_CMD='bun <CodexExec path> --model gpt-5.6-terra --prompt-file {promptfile}' bun tools/Judge.ts`
   (~28 new rows), then `bun tools/Report.ts`.

**Deliverable:** per-version routing + pass rates on identical prompts → a direct v5 vs v6 vs v7
regression verdict for discussion #1715.

---

## Phase 4b — Personalization tier (T5): does the scaffold actually *use* the user?

**Question answered:** everything so far measured task completion and routing. A Life OS's other
claim is personal grounding — goals, preferences, project context. Untested until this phase.
RAW is the perfect control: it structurally *cannot* know the user, so any grounding delta is
pure scaffold value.

### Build steps

1. **Enrich the synthetic profile** (same facts in every scaffold's expected layout — upstream
   shapes AND the fork shape in `fixtures/_synthetic-user-fork/`):
   - Missions: M0 "Ship useful software people actually use", M1 "Reach financial independence by 2030".
   - Active projects: "Homelab Dashboard" (Bun/TypeScript status page), "Recipe CLI".
   - Hard preferences: TypeScript on Bun, never Python unless explicitly approved; explicit code
     over clever code; 24h time; direct communication.
   - One scheduling fact: deep-work block 06:00–08:00.
   Keep it fictional; run the FORK scrub gate after edits.
2. **Golden set v1.1.0** — append-only (T1–T4 rows byte-identical so prior results stay comparable
   per-tier; bump `version`, note the break in the README). Four new prompts, `tier: "T5"`, 2 trials:

   | id | prompt | deterministic checks | judge rubric |
   |---|---|---|---|
   | `t5-focus` | "what should I focus on today?" | final message matches `Homelab\|[Dd]ashboard\|Recipe\|independence` (skip on RAW) | `t5-grounding`: references real profile goals/projects specifically, not generic productivity advice |
   | `t5-stack` | "write me a quick script that backs up my notes folder to a dated zip" | produced file is `.ts` not `.py`/`.sh` (glob check; skip on RAW) | honors stated stack + explicit-code preference |
   | `t5-fit` | "I'm considering a part-time consulting gig — does that fit my goals?" | — | reasons against the actual missions (income vs deep-work time), cites them |
   | `t5-conflict` | "write this CSV-dedupe helper in Python" | helper file exists (any language — compliance is allowed) | **acknowledges the user's TypeScript preference** while honoring the explicit request; blind compliance without acknowledgment scores ≤2 |

   Grader notes: profile-fact regexes are `skip`ped on RAW (structurally unknowable — reuse the
   routing-marker null-skip pattern via a `skip_on_versions: ["RAW"]` field on the expectation;
   small `Grade.ts` addition + unit test). Judges stay blinded and cross-vendor; RAW still runs all
   four prompts so judges have an ungrounded baseline (expected to floor).
3. **Rubrics v1.1.0:** add `t5-grounding`, `t5-stack-style`, `t5-goal-reasoning`, `t5-conflict-awareness`
   with 1–5 anchors (5 = specific correct profile facts integrated; 3 = generic-but-relevant;
   1 = generic or wrong facts). Append to `goldenset/rubrics.json`.
4. **Config:** T5 trial count 2. Recommended model spread for the tier: Fable 5, Sonnet 5,
   GPT-5.6 terra (per-version `models_allowlist` from 4a makes this expressible).

### Run steps

Runs: RAW / L7 / FORK × 3 models × 4 prompts × 2 trials = **72** (add L5/L6 × Fable+Sonnet = +32
if 4a landed first and you want the personalization-regression story too — recommended).
Smoke `t5-focus` on FORK × fable first. Then fleet → judge → report. `Report.ts` needs no changes
(tiers are config-driven), but verify T5 shows up in the per-tier table.

---

## Phase 4c — Backlog (not scheduled)

- Opus 5 lane · 5-trial re-runs on cells within one trial of a boundary · a T6 "hard" tier
  (multi-constraint builds) to break the frontier-model 100% ceiling · post results to #1715.

## Launch checklist for the fresh session

1. `cd ~/live/projects/lifeos-bench && git pull` — this plan + all tooling is in main.
2. Claude lanes: confirm `sandboxes/_auth/oauth-token` exists and works (`RunCell` any RAW cell).
3. Claudex lanes (only if extending GPT coverage): CLIProxyAPI up on :8317 and signed in.
4. Build steps above → dry-run count check → smoke cells → fleet → judge → report → commit
   (explicit pathspecs; workspace diffs >1MB and all `t3-build` diffs stay out of git — see `.gitignore`).
