# Does LifeOS actually help?

Three released versions of LifeOS measured against a bare control, across eight models, on a frozen set of 21 prompts · golden set 2.0.0 · aggregate results only

## The question LifeOS #1715 asked

LifeOS is not a prompt. It is a Life Operating System: a constitutional system prompt, a `CLAUDE.md`
that routes behaviour, `@`-imported identity, TELOS and project context, **the Algorithm** — the
procedure the assistant is supposed to enter for any substantial work — plus hooks that enforce,
skills that specialise, and a memory system meant to compound across sessions.

[LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715) asked the
question every user of a framework like this eventually asks out loud:

> Does the scaffolding actually improve outcomes — on which models, at what token cost? And has
> LifeOS got *better* across its releases, or worse?

That cannot be settled by reading the framework, and it cannot be settled by anecdote. It needs a
control: the same models, the same prompts, the same harness, with and without LifeOS.

This is that experiment. Three released versions of LifeOS, a bare control with none of it, eight
models, 21 frozen prompts, deterministic graders where the answer is checkable and blinded
cross-vendor judges where it is not.

Four questions, answered in order: **has LifeOS degraded?** · **does the Algorithm still fire, and
does that depend on the model?** · **was an earlier version better?** · **what does this say about
models versus frameworks generally?** Then the part no benchmark of this shape can measure — and
what to do about all of it.

## Exactly what was tested

### The four configurations

| Lane | What it actually is | How it gets into the Algorithm |
|---|---|---|
| **RAW** | Bare Claude Code, empty config directory. No `CLAUDE.md`, no imports, no hooks, no Algorithm. The control. | n/a — there is no Algorithm to enter |
| **L5** | **PAI v5.0.0** — the last release under the PAI name. Ships a complete `.claude` tree with identity imports already active and the mode templates written inline in `CLAUDE.md`. | **Prose.** `CLAUDE.md` tells the model, in words, to read the Algorithm before substantial work. Nothing is spawned. |
| **L6** | **LifeOS v6.0.5** — three modes (ALGORITHM / NATIVE / MINIMAL), defined only in `LIFEOS_SYSTEM_PROMPT.md`. | **A classifier hook.** `TheRouter.hook.ts` calls a model on every prompt to choose the mode. |
| **L7** | **LifeOS v7.28.3** — modes retired outright on 2026-07-11: *"One format, every response — there are no modes."* No mode or Algorithm classifier ships at all. | **Prose in the system prompt.** Six hooks still fire on every prompt; none of them decides whether to enter the Algorithm. |

Each version is staged from its own upstream tag and installed by **its own installer** rather than
a reimplementation, then given the same synthetic user profile. The GPT lanes run through the
*same* Claude Code harness via a local ChatGPT-auth proxy, so hooks fire identically and the only
difference is the model.

### The five tiers, and why each exists

Twenty-one prompts, frozen as golden set 2.0.0. Each tier probes a different claim LifeOS makes
about itself:

| Tier | What it probes | Why it is here |
|---|---|---|
| **T1** | Trivial requests — a fact, a one-line edit, an acknowledgement | A Life OS must **get out of the way**. If a framework makes "thanks, that's all for now" expensive, that is cost with no benefit. |
| **T2** | Ordinary coding and analysis — a failing test, a script, a CSV question | The bread-and-butter work, and the effect users would feel daily. |
| **T3** | Heavy engineering — build a CLI with tests, debug across three modules, refactor without changing behaviour, produce a plan | **Where the Algorithm is supposed to fire.** If it ever earns its cost, it earns it here. |
| **T4** | Traps where phrasing and scope disagree — *"build me a quick stats page, nothing fancy"* (casual words, real work) and *"perform a comprehensive analysis to determine which is larger: 7 or 12"* (formal words, trivial work) | Routing claims live or die here. A framework that routes on tone rather than scope fails one of these two. |
| **T5** | Personalization — *"what should I focus on today?"*, *"does this consulting gig fit my goals?"* | The thing only a Life OS can do. The control structurally **cannot** know the user, so its checks here are skipped rather than failed. |

T3 and T4 carry the Algorithm-**entry** checks. T1 and T4's trivial prompt carry the opposite
check — the Algorithm must **not** be entered. Those are reported as separate columns throughout,
never averaged: every version passes the second kind, so combining them hides the first.

The complete prompt set and the checks applied to each are below. Nothing was added or reworded
after the runs began.

### How it was graded

- **Code graders** where the answer is checkable: tests pass, exact outputs, files changed or left
  alone, tool-call and token budgets, and whether the Algorithm file was read before substantial
  work began.
- **Blinded cross-vendor judges** where it is not: banner lines are stripped before the judge sees
  the response, Claude-family cells are judged by GPT and GPT cells by Claude. Nothing self-grades.
  For personalization the judge is handed the synthetic profile as ground truth, so it can tell a
  correct citation from an invented one.
- **Isolation**: every cell gets its own `$HOME` cloned from a staged template, a `sandbox-exec`
  profile denying the operator's real home, and a containment scan that invalidates any cell that
  escapes. Each cell also records what its hooks wrote, so *"was the enforcement layer actually
  running"* is a number in the dataset rather than a claim in a README.

### The versions under test

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | run | run | run | run | run | run | run | run |
| L5 | run | — | — | — | — | run | — | — |
| L6 | run | run | run | run | run | run | run | run |
| L7 | run | run | run | run | run | run | run | run |

### Trials per tier

| Tier | Trials | Models |
| --- | --- | --- |
| T1 | 1 | all lane models |
| T2 | 1 | all lane models |
| T3 | 2 | all lane models |
| T4 | 2 | all lane models |
| T5 | 2 | sonnet-5, gpt-5.6-terra |

### The complete prompt set

| Tier | Prompt id | What the model was asked | Checks |
| --- | --- | --- | --- |
| T1 | t1-fact | What port does nginx listen on by default for plain HTTP? | correct_answer, routed_light, algorithm_skipped, format_compliance |
| T1 | t1-edit | In notes/todo.md, change 'buy milk' to 'buy oat milk'. Nothing else. | edit_applied, old_text_gone, no_collateral_edits, routed_light |
| T1 | t1-ack | thanks, that's all for now | no_tools_fired, routed_light, algorithm_skipped |
| T1 | t1-time | Convert 14:30 UTC to US Mountain Daylight Time. | correct_answer, routed_light |
| T2 | t2-bugfix | The test in this repo is failing. Find the bug and fix it. Do not modify the test. | tests_pass, test_untouched |
| T2 | t2-script | Write a bun script at tools/count.ts that counts total lines across all .md files under docs/ and prints only the number. | correct_count |
| T2 | t2-research | Summarize the three main tradeoffs between SQLite and Postgres for a single-user local-first app. Be concrete. | quality_floor |
| T2 | t2-csv | Look at data/sales.csv and tell me which month had the highest total revenue, and what that total was. | correct_month, correct_total |
| T3 | t3-build | Build a small CLI at src/fetchcache.ts: it takes a URL, fetches it, caches the response body to .cache/ keyed by URL hash with a 60s TTL, and serves from cache when fresh. Include tests that don't hit the network (mock or local fixtures). Make the tests pass. | tests_pass, artifact_exists, routed_heavy, quality_floor, algorithm_entered |
| T3 | t3-debug | bun test fails in this repo. The bug is somewhere in the interaction between the three modules in src/. Find the root cause and fix it with the smallest correct change. Explain the root cause. | tests_pass, surgical_fix, root_cause_named, algorithm_entered, format_compliance |
| T3 | t3-refactor | Refactor src/report.ts so pure computation is separated from file IO (two modules). Behavior must not change: bun run src/report.ts must produce byte-identical output to before. Keep the existing test green and add tests for the pure module. | tests_pass, behavior_preserved |
| T3 | t3-plan | Create a plan for migrating this app from JSON-file storage to SQLite. Don't implement anything yet. | plan_means_stop, plan_quality |
| T4 | t4-casual-complex | build me a quick stats page for the numbers in data/metrics.json, nothing fancy | casual_phrasing_not_downgraded, artifact_exists, algorithm_entered |
| T4 | t4-formal-trivial | Please perform a comprehensive analysis to determine which of the following two numbers is larger: 7 or 12. | correct_answer, formal_phrasing_not_upgraded, no_overkill, algorithm_skipped |
| T4 | t4-ambiguous | my tests are failing | reproduced_before_fixing, tests_pass_after |
| T4 | t4-multi | rename this project from 'foldx' to 'nimbus' everywhere it matters and make sure nothing still references the old name | no_stale_references, tests_still_pass |
| T5 | t5-focus | what should I focus on today? | cites_real_projects, grounding_quality |
| T5 | t5-schedule | when should I block two hours of deep work tomorrow? | honors_deep_work_block, grounding_quality, format_compliance |
| T5 | t5-stack | write me a quick script that backs up my notes folder to a dated zip | used_typescript, honors_stack_preference |
| T5 | t5-fit | I'm considering a part-time consulting gig - does that fit my goals? | reasons_against_real_goals |
| T5 | t5-conflict | write this CSV-dedupe helper in Python | helper_produced, acknowledges_preference |

### What was run

| Recorded cells | Successful cells | Recorded cost USD | Recorded wall-clock hours |
| --- | --- | --- | --- |
| 704 | 703 | 474.63 | 20.38 |

| Version | Cells | Statuses |
| --- | --- | --- |
| RAW | 212 | success: 211, timeout: 1 |
| L5 | 68 | success: 68 |
| L6 | 212 | success: 212 |
| L7 | 212 | success: 212 |

### Enforcement-layer state files written per cell, by version

Evidence that the hook layer actually ran, recorded per cell. The control registers no hooks and writes nothing; every LifeOS version writes 22–25 files per cell.

**Chart data**

| Version | Hook files mean |
| --- | --- |
| RAW | — |
| L5 | 24 |
| L6 | 22.1 |
| L7 | 25.4 |

## Has LifeOS degraded?

**On general work: no measurable benefit. On personalization: every version is transformative. On
Algorithm engagement: yes, but L6's result is confounded.**

The widened L6 lane now supports an all-eight comparison for RAW, L6, and L7. L5 remains limited
to the two bisect models:

| Version | Model base | T1–T4 pass@k | T1–T4 pass^k |
|---|---|---:|---:|
| **RAW** (control) | all eight | **96.1%** | 92.2% |
| L5 · PAI v5.0.0 | bisect models only | 96.9% | 90.6% |
| L6 · LifeOS v6.0.5 | all eight | 91.4% | 88.3% |
| L7 · LifeOS v7.28.3 | all eight | 93.0% | 88.3% |

The added six-model L6 sweep **moved rather than confirmed** the earlier bisect ladder. On those two
models, RAW/L5/L6/L7 pass@k was 96.9%/96.9%/93.8%/90.6%. In the six added models alone, RAW/L6/L7
are 95.8%/90.6%/93.8%. The L6/L7 order therefore reverses outside the bisect pair, so a monotone
version-degradation claim is not supported. The honest reading is *no measurable general-task
benefit*, not *LifeOS makes models worse*.

On personalization the direction reverses and the size is not subtle: the control passes **40.0%**
and every LifeOS version passes 90–100%. That is what the framework is for, and it works.

Format compliance is the clearest structural improvement over L5 — 70% under L5, 100% under L6,
and 96.4% under L7, the last dragged down entirely by Haiku 4.5 at 66.7%. The two newer versions
are markedly better at doing what they say they will do with their output.

The real regression is not on this page's tables. It is whether the Algorithm runs at all.

### Task pass@k on T1–T4 and on T5, by version

Left group: the four general tiers. Right group: personalization. The control (RAW) leads on general work and collapses on personalization; every LifeOS version does the reverse.

**Chart data**

| Version | T1–T4 (bisect models) pass@k % | T5 personalization pass@k % |
| --- | --- | --- |
| RAW | 96.9 | 40 |
| L5 | 96.9 | 100 |
| L6 | 93.8 | 90 |
| L7 | 90.6 | 90 |

### Pass-rates by tier group

| Version | Scope | Tiers | Prompts | pass@k % | pass^k % |
| --- | --- | --- | --- | --- | --- |
| RAW | bisect models | T1-T4 | 32 | 96.9 | 93.8 |
| RAW | bisect models | T5 | 10 | 40 | 10 |
| RAW | model sweep | T1-T4 | 96 | 95.8 | 91.7 |
| L5 | bisect models | T1-T4 | 32 | 96.9 | 90.6 |
| L5 | bisect models | T5 | 10 | 100 | 60 |
| L6 | bisect models | T1-T4 | 32 | 93.8 | 93.8 |
| L6 | bisect models | T5 | 10 | 90 | 70 |
| L6 | model sweep | T1-T4 | 96 | 90.6 | 86.5 |
| L7 | bisect models | T1-T4 | 32 | 90.6 | 87.5 |
| L7 | bisect models | T5 | 10 | 90 | 60 |
| L7 | model sweep | T1-T4 | 96 | 93.8 | 88.5 |

### Output-format compliance, by version and model

Whether each response opened with the version's own documented format contract. The control has none to honour, so it has no bar.

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 60 | — | — | — | — | 80 | — | — |
| L6 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| L7 | 100 | 100 | 66.7 | 100 | 100 | 100 | 100 | 100 |

## Does the Algorithm still fire — and does that depend on the model?

This is the sharpest result in the study, and it stayed invisible until the Algorithm-entry checks
were separated from their opposite.

Three heavy prompts × two trials = six chances per lane to read the Algorithm before starting real
work:

| Version | Claude models | GPT-5.6 models |
|---|---|---|
| **L5** — prose routing in `CLAUDE.md` | sonnet-5 **5 of 6** | terra **6 of 6** |
| **L6** — classifier hook | all five Claude models **0 of 6** | all three GPT-5.6 models **0 of 6** — confounded: its nested `claude` has no sandbox credentials |
| **L7** — prose in the system prompt, no classifier | sonnet-5, haiku-4.5, opus-5, opus-4.8 all **0 of 6**; fable-5 1 of 6 | terra, luna, sol all **6 of 6** |

Three different things are happening here and they need separating:

1. **v5's prose routing worked, on both vendors.** Plain instructions in `CLAUDE.md`, no machinery,
   and a Claude model entered the Algorithm on 5 of 6 heavy prompts. That is the existence proof
   that Claude models *can* be driven into the Algorithm — they are not simply refusing.
2. **v6's zero is confounded and should not be read as a regression.** Its router spawns a nested
   model call, and this harness places no credentials inside a sandbox by design, so the classifier
   cannot authenticate and fails safe. What the result *does* show is that v6 kept **no prose
   fallback**: when the hook cannot run, nothing else carries the instruction.
3. **v7's result is not confounded at all, and it is a model effect.** v7 ships **no mode or
   Algorithm classifier** — nothing in it decides that a turn is an Algorithm run. Six hooks do
   still fire on every prompt, but unlike v6's router they are deterministic and make no model
   call, so the credential boundary never touches them. The instruction lives in the system prompt
   as prose, identical for every model. Every GPT-5.6 lane follows it 6 of 6. Four Claude lanes
   ignore it 0 of 6; Fable 5 follows it once in six tries.

   The recorded artifacts confirm v7's hooks ran rather than failing quietly: in one L7 build cell
   they tracked seven tool calls and wrote `runWasOpen: false`. The enforcement layer was live and
   watching, and correctly observed that no Algorithm run was ever opened — because nothing in v7
   tries to open one. It nudges after the fact; it does not route.

### It is not prose versus no prose — it is register

Both v5 and v7 carry the same instruction, pointing at the same file. They differ in how loudly
they say it, and where:

| | Where it lives | How it reads |
|---|---|---|
| **L5** | `CLAUDE.md`, under an explicit `ALGORITHM MODE` heading | **"MANDATORY FIRST ACTION:"** read the Algorithm — and "**Do NOT improvise** your own 'algorithm' format" |
| **L7** | the system prompt, under `## The Algorithm` | "**First action for such work:** read the Algorithm…" |

Same instruction, same imperative mood, no classifier behind either one. v5's emphatic form gets a
Claude model to 5 of 6. Under v7's calm form, four Claude models fall to 0 of 6 and Fable 5 reaches
1 of 6 — while every GPT model follows the calm form perfectly.

That inversion is worth sitting with, because it cuts against standard prompt hygiene. The usual
advice for modern models is to strip `MUST` and `CRITICAL`, on the grounds that emphatic language
causes over-triggering. v7 reads as though it took that advice, and on one vendor the behaviour
left with the emphasis.

So: *does the Algorithm still fire?* **On GPT models, always. On Claude models, reliably only under
v5; v7 produced one Fable exception in 30 Claude heavy-prompt opportunities.** And *is that the
framework or the model?* **Both, in different places** — v7 exposed a model-compliance gap that
v5's louder prose had been covering.

The mirror-image check confirms nobody is merely over-triggering: on trivial prompts every version
correctly stays out of the Algorithm, near-perfectly. The one exception is L5 on GPT, which enters
it on half the trivial prompts too. v5's instruction is louder in both directions.

### Did the version enter the Algorithm before heavy work?

Three heavy prompts × two trials = six checks per lane. RAW has no Algorithm, so it has no bar. **L5 enters reliably. L6 is 0 of 6 across every model, with the nested-`claude` credential confound. Under L7, four Claude models are 0 of 6, Fable is 1 of 6, and every GPT model is 6 of 6.**

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 83.3 | — | — | — | — | 100 | — | — |
| L6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| L7 | 0 | 16.7 | 0 | 0 | 0 | 100 | 100 | 100 |

### Did it correctly STAY OUT of the Algorithm on trivial work?

The same grader asking the opposite question on four trivial prompts. Near-perfect everywhere — which is exactly why averaging it with the chart above hides the result.

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 100 | — | — | — | — | 50 | — | — |
| L6 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| L7 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

## Was an earlier version better?

**Yes — at different things, and not the ones a version number implies.**

| | L5 · PAI v5.0.0 | L6 · LifeOS v6.0.5 | L7 · LifeOS v7.28.3 |
|---|---|---|---|
| Enters the Algorithm on heavy work | **best** — 5–6 of 6 | 0 of 6 on **all eight models** (nested-`claude` / no-sandbox-credentials confound) | Claude: four models 0 of 6, Fable 1 of 6 · GPT: 6 of 6 |
| Stays out on trivial work | over-fires on GPT | perfect | perfect |
| T1–T4 pass@k (bisect models) | **96.9%** | 93.8% | 90.6% |
| T1–T4 pass@k (all eight; L5 unavailable) | — | 91.4% | 93.0% |
| T5 personalization pass@k | **100%** | 90% | 90% |
| Format contract honoured | 70% | **100%** | 96.4% |
| Output tokens per cell | 10.9k | 3.0k | **2.9k** |

L5 wins the two things LifeOS exists to do — enter the Algorithm, use the user's real context — and
pays roughly **4–5× the generated tokens of every other configuration**, including the bare
control, for a general task pass-rate no better than the control's. That is the trade in one line:
**v5 buys Algorithm engagement with tokens.**

The all-eight L6 sweep puts it at 3.0k output tokens per cell, against L7's 2.9k and RAW's 2.8k;
its perfect format contract remains the strongest result. Its Algorithm-entry result is **0 of 6 on
all eight models**, but that is not a regression finding: routing is delegated to a nested `claude`
that cannot authenticate because the sandbox intentionally holds no credentials.

L6 and L7 now both cover all eight models. L7 holds a near-perfect format contract on seven of them
and, for a Claude user, its Algorithm remains effectively inert.

### Mean output tokens generated per cell, by version

What each version costs in generated tokens for the same 21 prompts. L5 spends 4–5× what L6, L7 or the bare control spend.

**Chart data**

| Version | Tokens mean |
| --- | --- |
| RAW | 2762.5 |
| L5 | 10906.4 |
| L6 | 3002 |
| L7 | 2888.9 |

## What this says about models, frameworks, and where the value is

**The bare control is much stronger than the framing of #1715 assumed.** Four of the eight models
reach **100% pass@k with no scaffolding at all** on the prompts they ran, and the entire spread
across all four configurations on general tiers is about six points. On ordinary work in 2026, the
model is doing the heavy lifting.

The per-model delta between LifeOS 7 and the bare control swings both ways and does not sort by
model tier — the largest gain is on a mid-tier model and the largest loss on a premium reasoning
lane. At one or two trials per prompt, only two of the eight sit outside the noise band.

The single biggest model effect measured here is not capability at all — it is **instruction
compliance**. Given the same system prompt telling them to read the Algorithm first, GPT-5.6 lanes
comply 100% of the time; Claude lanes comply once in 30 heavy-prompt opportunities (3.3%). A
framework built on written instruction inherits that difference wholesale.

Which points at the general lesson: **a framework's leverage is in what it supplies, not in what it
instructs.** The one place LifeOS shows a large, unambiguous, reproducible effect is the tier where
it *supplies* something the model could not otherwise have — the user's own goals, projects and
preferences. Where it only *instructs* — enter the Algorithm, use this format — the effect is
contingent on the model choosing to comply.

### L7 minus the bare control, task pass@k

Positive means LifeOS 7 beat the bare control on that model. One prompt is worth 4.8–6.3 points here, so only sonnet-5 and gpt-5.6-sol sit outside the noise band.

**Chart data**

| Model | L7 minus RAW pass@k (pp) |
| --- | --- |
| sonnet-5 | 14.3 |
| fable-5 | 0 |
| haiku-4-5 | 0 |
| opus-5 | -6.2 |
| opus-4-8 | 6.3 |
| gpt-5.6-terra | 0 |
| gpt-5.6-luna | 0 |
| gpt-5.6-sol | -12.5 |

## What this benchmark cannot see

Read this before treating the numbers above as a verdict on LifeOS. A 21-prompt, single-turn,
cold-start benchmark measures the shallowest layer of a Life OS, and most of what LifeOS is built
to do is structurally out of frame:

- **Memory and continuity.** Every cell is a fresh session with no history. LifeOS's whole memory
  architecture — work artifacts, decisions, learnings compounding across sessions — cannot produce
  any value in a design where nothing is ever the second session.
- **Recording work for future reference.** The ISA-per-task discipline pays off weeks later, when
  someone asks *why did we do it that way*. No benchmark of one-shot prompts can price that.
- **A personalized DA over time.** Voice, relationship, accumulated context about people and
  projects, knowing when to push back — measured here only as "did it cite the right project".
- **Multi-turn work.** Plan → approve → build → verify is the actual loop. Every prompt here is one
  turn with no human in it.
- **Enforcement that needs credentials.** Hooks that call a model — the router, satisfaction
  capture — cannot authenticate inside a sandbox that deliberately holds none. Their contribution
  is unmeasured by construction, not judged and found wanting.
- **Skills, delegation, and autonomy.** On-demand skill packs, subagent fan-out, scheduled runs,
  the dashboard — barely touched by 21 prompts and untouched by any of them at scale.
- **The actual outcome.** A Life OS is judged on whether its user gets where they were going. That
  is a longitudinal question, and this is a cross-sectional instrument.

None of that excuses the results above; those numbers are real. It is a statement of scope. **What
is measured here is the thin edge of LifeOS: single-turn task quality, instruction compliance,
format, and grounding.** On the thin edge, the framework is roughly neutral except where it
supplies context. Everything thicker is where its case still has to be made.

## Conclusions

### On LifeOS versions

- **Do not upgrade for task quality.** The general-task ladder is flat-to-slightly-down across
  three releases. Nothing here recommends a newer version on those grounds.
- **Do not revert either.** v5 costs 4–5× the tokens and has the weakest format contract. The move
  is not to go back but to **port v5's prose-level Algorithm instruction forward into v7** — it is
  the only mechanism in this study that got a Claude model into the Algorithm.
- **Keep the format contract.** It improved sharply after v5 and remained near-perfect, at no
  measurable task-quality cost.
- **v6's lesson is the durable one:** routing that lives only in machinery disappears the moment
  the machinery cannot run, and takes no fallback with it. Any enforcement worth having needs a
  prose floor underneath it.

### On models

- **For LifeOS-style written instruction, GPT-5.6 lanes comply and Claude lanes almost never do** —
  100% vs 3.3% on the identical system prompt. If you run LifeOS on a Claude model and expect the
  Algorithm to fire, verify it; today it is not reliable.
- **On ordinary work, pick the model, not the scaffold.** Four of eight models are already at 100%
  bare on this prompt set.
- **Small models pay their cost in form, not substance.** Haiku 4.5 holds its task pass-rate under
  LifeOS and drops to 66.7% on format compliance — the opposite of the usual claim that small
  models get worse under scaffolding.

### How LifeOS could improve, in priority order

1. **Make Algorithm entry deterministic instead of instructed.** The one thing this study shows
   unambiguously is that written instruction is not reliable across vendors. A pre-tool gate, or a
   hook that needs no credential, removes the model's vote.
2. **Restore a prose fallback for every hook-enforced behaviour.** v6 proved what happens without
   one.
3. **Re-test with v5's routing language grafted onto v7.** That is a one-file experiment, and this
   harness answers it in a few hundred cells.
4. **Attack token cost deliberately.** v5 at 10.9k per cell is the ceiling; v6 at 2.0k is the floor
   and it is *below the bare control*. Cost is a design variable, not a consequence.
5. **Build evals for the parts that matter.** Multi-turn sessions, memory carried across sessions,
   work artifacts reused, delegation. The single-turn edge is now measured; the rest is not.

## How much weight these numbers carry

- **Trial counts are low.** Within a lane, one prompt is still worth 4.8–6.3 points; the added
  all-eight T1–T4 aggregate has 128 prompt outcomes, so one outcome is 0.8 points, but it does not
  create five independent trials of any model. Treat smaller lane-level differences as noise. The
  L6 0-of-6 Algorithm result across all eight models is still unmeasurable as routing because its
  nested `claude` has no sandbox credentials; it is not an unqualified regression.
- **The judge bar is permissive.** A rubric passes at 3 of 5. Scores are bimodal, and all 41 threes
  count as passes — including at least one whose own reasoning says the answer failed the thing the
  rubric asked about. Raising the bar to 4 would reclassify 15.6% of verdicts.
- **v6's Algorithm result is confounded** by the credential boundary described above.
- **Wall-clock is not comparable** across cells; they ran concurrently and contended for CPU. Token
  counts, cost and pass-rates are unaffected.
- **The control is bare of LifeOS, not of all scaffolding** — it still carries Claude Code's
  bundled skills.
- **This dataset is a re-run.** An earlier attempt was invalidated when its cells escaped their
  sandbox, and a later one when every LifeOS cell turned out to be running with its hook layer
  silently disabled. Both were caught by the harness's own gates, both were discarded rather than
  patched, and these numbers come from a clean run with the enforcement layer verifiably live.
  Eighteen harness and grader defects were found and fixed along the way, each with a regression
  test; they are listed below, because a benchmark's credibility rests on how it catches its own
  errors rather than on claiming it made none.

### Judge score distribution

Scores are bimodal, and the pass bar is 3 of 5 — so every score of 3 counts as a pass. The chart data carries the current distribution; the caveat above records the exact threshold sensitivity.

**Chart data**

| Score | Verdicts |
| --- | --- |
| 1 | 36 |
| 2 | 2 |
| 3 | 41 |
| 4 | 40 |
| 5 | 143 |

### Recorded defects

| id | defect | effect |
| --- | --- | --- |
| 1 | L6/L7 staged with zero hooks | Their enforcement layer never ran; format compliance scored 0% |
| 2 | Config root not nested under $HOME | Upstream relative imports crashed the format-enforcing hook |
| 3 | Inherited PATH carried operator paths | Clean cells were marked contaminated on an environment dump |
| 4 | Real OAuth credentials reachable in-sandbox | Credential exposure in cells running with permissions bypassed |
| 5 | LeakCheck patterns unanchored | Scaffold documentation scored as a sandbox escape |
| 6 | workspace_diff_count counted hook state | Penalised only versions WITH hooks — silently favoured the control |
| 7 | Claude-side judge not blinded | Graded synthetic-persona answers against the operator's real profile |
| 8 | Judge prompt omitted the persona | T5 grounding judged against materials the judge could not see |
| 9 | Fleet/Judge had no wave or vendor filter | A wave would have run 424 cells instead of 136; cross-vendor blinding was inexpressible |
| 10 | Cells leaked browser processes | Orphaned browsers drove machine load to 13; inflated wall-clock and caused false timeouts |
| 11 | LeakCheck counted a kernel refusal as an escape | Invalidated a cell whose boundary held, when a browser crash handler probed the operator profile and was denied |
| 12 | Cell cwd inside the seatbelt's denied home | Emptied process.env for EVERY Bun hook, disabling the router and producing a routing result that was really a harness artifact |
| 13 | No node_modules in any staged install | Hooks import a YAML parser from a dozen of their own files; Bun's auto-install cannot write a tempdir inside the seatbelt, so the hook layer still could not start after the cwd fix |
| 14 | Staged install SHARED by every cell in a lane | Hooks wrote context-bearing state into the tree the next cell loads — cross-cell coupling, and a race at concurrency > 1 |
| 15 | Hook-state capture copied vendored plugin docs | A bundled doc quoting an example home path landed in the graded artifact directory, where LeakCheck correctly read it as an escape and marked a clean cell contaminated |
| 16 | A skipped grader counted as a task failure | The golden set skips checks that cannot apply to a version — the control structurally cannot know the persona — so a documented exemption became a failure. Penalised only the control |
| 17 | Prompts a lane never ran counted against it | tier_models restricts T5 to two models, but pass@k divided by all 21 prompts regardless, so six of eight model lanes were graded on five prompts they were never scheduled to run. Understated every restricted lane by up to 23.8 points and produced the retracted claim that no model passes 100% bare |
| 18 | Retired-lane artifacts left inside the scanned results tree | The retired private-fork lane's cells still sat in results/, and they legitimately contain real identity, so a full containment scan reported 101 violating files with zero in any live cell — a gate whose exit code no longer distinguished a sandbox escape from a retired lane's own content. Fixed by quarantining those trees, NOT by exempting them from the scanner |
| 19 | Algorithm entry averaged with Algorithm skip | code:algorithm_read asks opposite questions on opposite prompts — enter the Algorithm for heavy work, stay out of it for trivial work. Every version passes the skip checks, so a single combined column dragged a 0-of-6 entry rate up to a passing-looking 40% and hid the largest effect in the dataset. Split into separate columns keyed on the golden set's own expect field |

## Appendix

Every figure on this page is regenerated from the recorded per-cell artifacts by one shared
aggregation module, so the charts, the tables and the Markdown report cannot disagree. The harness,
the frozen prompt set, and step-by-step instructions for reproducing this — or for pointing it at
your own framework — are in the repository.

### Metric glossary

| Data key | Meaning |
| --- | --- |
| algorithm_entry_pct | Share of HEAVY prompts where the version read its Algorithm before starting work. Three prompts, two trials each. |
| algorithm_skip_pct | Share of TRIVIAL prompts where it correctly did NOT read the Algorithm. Every version passes these, which is why they are a separate column. |
| mode_marker_pct | Share of responses carrying the version's own documented mode banner. Null for versions that ship no modes. |
| format_pct | Share of applicable output-format checks that passed. |
| task_at_k_pct | Share of scheduled task prompts with at least one passing trial. |
| task_all_k_pct | Share of scheduled task prompts whose trials all passed. |
| task_prompts | Prompts this lane was scheduled to run — restricted tiers are absent from the lanes that never ran them, so this is the pass-rate denominator. |
| cells | Cells with a readable meta.json record. |
| statuses | Histogram of meta.status values. |
| output_tokens_mean | Mean generated output tokens per recorded cell. |
| wall_clock_mean_s | Mean recorded wall-clock seconds per cell. |
| cost_usd_total | Recorded total cost in US dollars. |
| hook_files_mean | Mean hook-state files written where recorded. |

### Every lane

| Version | Model | Prompts | Algorithm entered % | Algorithm skipped % | Mode markers % | Format % | Task @k % | Task all-k % | Cells | Tokens mean | Wall s mean | Cost USD | Hook files mean | Statuses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | sonnet-5 | 21 | — | — | — | — | 76.2 | 76.2 | 34 | 2231.5 | 45.55 | 5.66 | — | success: 34 |
| RAW | fable-5 | 16 | — | — | — | — | 100 | 100 | 24 | 4122.4 | 123.61 | 18.29 | — | success: 24 |
| RAW | haiku-4-5 | 16 | — | — | — | — | 87.5 | 75 | 24 | 2937.8 | 40.86 | 1.45 | — | success: 24 |
| RAW | opus-5 | 16 | — | — | — | — | 100 | 93.8 | 24 | 4050.3 | 185.8 | 7.56 | — | success: 23, timeout: 1 |
| RAW | opus-4-8 | 16 | — | — | — | — | 87.5 | 87.5 | 24 | 2399.9 | 37.59 | 4.76 | — | success: 24 |
| RAW | gpt-5.6-terra | 21 | — | — | — | — | 90.5 | 71.4 | 34 | 1650.7 | 61.98 | 7.08 | — | success: 34 |
| RAW | gpt-5.6-luna | 16 | — | — | — | — | 100 | 93.8 | 24 | 2786.8 | 109.91 | 9.51 | — | success: 24 |
| RAW | gpt-5.6-sol | 16 | — | — | — | — | 100 | 100 | 24 | 2605.3 | 140.37 | 10.23 | — | success: 24 |
| L5 | sonnet-5 | 21 | 83.3 | 100 | 60 | 60 | 95.2 | 85.7 | 34 | 12495.4 | 224.15 | 50.13 | 14.1 | success: 34 |
| L5 | gpt-5.6-terra | 21 | 100 | 50 | 70 | 80 | 100 | 81 | 34 | 9317.4 | 425.57 | 93.41 | 33.8 | success: 34 |
| L6 | sonnet-5 | 21 | 0 | 100 | 60 | 100 | 95.2 | 90.5 | 34 | 2532.4 | 57.41 | 14.96 | 22.1 | success: 34 |
| L6 | fable-5 | 16 | 0 | 100 | 60 | 100 | 93.8 | 87.5 | 24 | 5023.9 | 84.95 | 48.54 | 23.1 | success: 24 |
| L6 | haiku-4-5 | 16 | 0 | 100 | 60 | 100 | 75 | 68.8 | 24 | 3058.4 | 66.06 | 3.42 | 23 | success: 24 |
| L6 | opus-5 | 16 | 0 | 100 | 60 | 100 | 93.8 | 93.8 | 24 | 4621.5 | 74.29 | 22.09 | 22 | success: 24 |
| L6 | opus-4-8 | 16 | 0 | 100 | 60 | 100 | 93.8 | 87.5 | 24 | 2651.8 | 77.56 | 17.77 | 22.5 | success: 24 |
| L6 | gpt-5.6-terra | 21 | 0 | 100 | 60 | 100 | 90.5 | 85.7 | 34 | 1539.4 | 65.22 | 11.71 | 21.5 | success: 34 |
| L6 | gpt-5.6-luna | 16 | 0 | 100 | 60 | 100 | 100 | 93.8 | 24 | 2659.8 | 107.79 | 13.05 | 21.3 | success: 24 |
| L6 | gpt-5.6-sol | 16 | 0 | 100 | 60 | 100 | 87.5 | 87.5 | 24 | 2734.1 | 80.95 | 10.39 | 21.7 | success: 24 |
| L7 | sonnet-5 | 21 | 0 | 100 | — | 100 | 90.5 | 85.7 | 34 | 2116.7 | 34.06 | 11.57 | 24.7 | success: 34 |
| L7 | fable-5 | 16 | 16.7 | 100 | — | 100 | 100 | 100 | 24 | 3108.6 | 85.19 | 31.58 | 26.7 | success: 24 |
| L7 | haiku-4-5 | 16 | 0 | 100 | — | 66.7 | 87.5 | 68.8 | 24 | 2831.6 | 42.45 | 2.33 | 26 | success: 24 |
| L7 | opus-5 | 16 | 0 | 100 | — | 100 | 93.8 | 87.5 | 24 | 3604.8 | 59.52 | 15.44 | 25.1 | success: 24 |
| L7 | opus-4-8 | 16 | 0 | 100 | — | 100 | 93.8 | 93.8 | 24 | 2061.1 | 41.58 | 12.81 | 25.6 | success: 24 |
| L7 | gpt-5.6-terra | 21 | 100 | 100 | — | 100 | 90.5 | 76.2 | 34 | 3137.1 | 113.53 | 23.15 | 25.6 | success: 34 |
| L7 | gpt-5.6-luna | 16 | 100 | 100 | — | 100 | 100 | 100 | 24 | 2884.6 | 77.66 | 11.14 | 24.3 | success: 24 |
| L7 | gpt-5.6-sol | 16 | 100 | 100 | — | 100 | 87.5 | 81.3 | 24 | 3584.7 | 165.45 | 16.62 | 25.8 | success: 24 |

### Every lane by tier

| Version | Model | Tier | Prompts | Algorithm entered % | Algorithm skipped % | Mode markers % | Format % | Task @k % | Task all-k % | Cells | Tokens mean | Wall s mean | Cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | sonnet-5 | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 135.3 | 5.35 | 0.28 |
| RAW | sonnet-5 | T2 | 4 | — | — | — | — | 75 | 75 | 4 | 999 | 16.83 | 0.46 |
| RAW | sonnet-5 | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 5758.3 | 138.75 | 2.44 |
| RAW | sonnet-5 | T4 | 4 | — | — | — | — | 100 | 100 | 8 | 1982 | 26.37 | 1.4 |
| RAW | sonnet-5 | T5 | 5 | — | — | — | — | 20 | 20 | 10 | 941.3 | 13.9 | 1.08 |
| RAW | fable-5 | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 139.5 | 5.39 | 1.51 |
| RAW | fable-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 887.3 | 18.86 | 1.03 |
| RAW | fable-5 | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 8211.5 | 130.46 | 10.15 |
| RAW | fable-5 | T4 | 4 | — | — | — | — | 100 | 100 | 8 | 3642.3 | 228.26 | 5.6 |
| RAW | haiku-4-5 | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 228.3 | 4.62 | 0.07 |
| RAW | haiku-4-5 | T2 | 4 | — | — | — | — | 50 | 50 | 4 | 1673.8 | 21.36 | 0.13 |
| RAW | haiku-4-5 | T3 | 4 | — | — | — | — | 100 | 75 | 8 | 6576.1 | 93.37 | 0.98 |
| RAW | haiku-4-5 | T4 | 4 | — | — | — | — | 100 | 75 | 8 | 1286.3 | 16.23 | 0.27 |
| RAW | opus-5 | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 106.8 | 5.19 | 0.29 |
| RAW | opus-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1647 | 27.12 | 0.47 |
| RAW | opus-5 | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 8482.4 | 273.19 | 4.5 |
| RAW | opus-5 | T4 | 4 | — | — | — | — | 100 | 75 | 8 | 2791.5 | 268.04 | 2.3 |
| RAW | opus-4-8 | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 109.8 | 4.85 | 0.4 |
| RAW | opus-4-8 | T2 | 4 | — | — | — | — | 50 | 50 | 4 | 824 | 17.41 | 0.4 |
| RAW | opus-4-8 | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 5138.5 | 76.27 | 2.74 |
| RAW | opus-4-8 | T4 | 4 | — | — | — | — | 100 | 100 | 8 | 1594.4 | 25.36 | 1.21 |
| RAW | gpt-5.6-terra | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 56.3 | 3.61 | 0.19 |
| RAW | gpt-5.6-terra | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 694 | 19.23 | 0.34 |
| RAW | gpt-5.6-terra | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 4142.4 | 145.25 | 3.55 |
| RAW | gpt-5.6-terra | T4 | 4 | — | — | — | — | 100 | 75 | 8 | 1769.5 | 87.95 | 2.35 |
| RAW | gpt-5.6-terra | T5 | 5 | — | — | — | — | 60 | 0 | 10 | 582.9 | 15.04 | 0.64 |
| RAW | gpt-5.6-luna | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 66.8 | 5.74 | 0.37 |
| RAW | gpt-5.6-luna | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 694.5 | 29.57 | 0.66 |
| RAW | gpt-5.6-luna | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 5028.1 | 219.58 | 5.14 |
| RAW | gpt-5.6-luna | T4 | 4 | — | — | — | — | 100 | 75 | 8 | 2951.5 | 92.51 | 3.34 |
| RAW | gpt-5.6-sol | T1 | 4 | — | — | — | — | 100 | 100 | 4 | 55.5 | 8.3 | 0.31 |
| RAW | gpt-5.6-sol | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 583.3 | 27.39 | 0.52 |
| RAW | gpt-5.6-sol | T3 | 4 | — | — | — | — | 100 | 100 | 8 | 4959.8 | 284.36 | 6.43 |
| RAW | gpt-5.6-sol | T4 | 4 | — | — | — | — | 100 | 100 | 8 | 2536.9 | 118.9 | 2.97 |
| L5 | sonnet-5 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 366.5 | 15.91 | 0.58 |
| L5 | sonnet-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 11732.3 | 181.92 | 5.07 |
| L5 | sonnet-5 | T3 | 4 | 100 | — | 0 | 0 | 100 | 75 | 8 | 22314.3 | 405.45 | 20.05 |
| L5 | sonnet-5 | T4 | 4 | 50 | 100 | 50 | — | 75 | 75 | 8 | 13503.9 | 192.04 | 11.24 |
| L5 | sonnet-5 | T5 | 5 | — | — | — | 100 | 100 | 80 | 10 | 8990.4 | 204.98 | 13.19 |
| L5 | gpt-5.6-terra | T1 | 4 | — | 50 | 50 | 100 | 100 | 100 | 4 | 1823.8 | 49.25 | 1.66 |
| L5 | gpt-5.6-terra | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 8773.5 | 356.63 | 9.38 |
| L5 | gpt-5.6-terra | T3 | 4 | 100 | — | 100 | 100 | 100 | 100 | 8 | 12384.1 | 697.6 | 30.96 |
| L5 | gpt-5.6-terra | T4 | 4 | 100 | 50 | 75 | — | 100 | 75 | 8 | 9597 | 357.96 | 21.61 |
| L5 | gpt-5.6-terra | T5 | 5 | — | — | — | 50 | 100 | 40 | 10 | 9855.5 | 440.15 | 29.79 |
| L6 | sonnet-5 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 398.3 | 14.75 | 1.35 |
| L6 | sonnet-5 | T2 | 4 | — | — | — | — | 75 | 75 | 4 | 1560.3 | 28.72 | 1.54 |
| L6 | sonnet-5 | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 5341.8 | 142.16 | 4.45 |
| L6 | sonnet-5 | T4 | 4 | 0 | 100 | 50 | — | 100 | 100 | 8 | 2618.5 | 44.5 | 4.16 |
| L6 | sonnet-5 | T5 | 5 | — | — | — | 100 | 100 | 80 | 10 | 1458.4 | 28.47 | 3.47 |
| L6 | fable-5 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 623.8 | 32.46 | 4.72 |
| L6 | fable-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1536 | 48.76 | 5.19 |
| L6 | fable-5 | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 9907.6 | 146.75 | 22.85 |
| L6 | fable-5 | T4 | 4 | 0 | 100 | 50 | — | 75 | 50 | 8 | 4084.3 | 67.48 | 15.78 |
| L6 | haiku-4-5 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 1174.3 | 26.19 | 0.34 |
| L6 | haiku-4-5 | T2 | 4 | — | — | — | — | 50 | 50 | 4 | 1226.8 | 27.7 | 0.35 |
| L6 | haiku-4-5 | T3 | 4 | 0 | — | 0 | 100 | 100 | 75 | 8 | 5635 | 131.39 | 1.87 |
| L6 | haiku-4-5 | T4 | 4 | 0 | 100 | 50 | — | 50 | 50 | 8 | 2339.8 | 39.83 | 0.85 |
| L6 | opus-5 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 355.5 | 18.7 | 2.28 |
| L6 | opus-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1865.8 | 44.64 | 2.56 |
| L6 | opus-5 | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 7890.4 | 110.79 | 8.21 |
| L6 | opus-5 | T4 | 4 | 0 | 100 | 50 | — | 75 | 75 | 8 | 4863.5 | 80.41 | 9.04 |
| L6 | opus-4-8 | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 407.5 | 21.49 | 2.28 |
| L6 | opus-4-8 | T2 | 4 | — | — | — | — | 75 | 75 | 4 | 1440.8 | 37.8 | 2.52 |
| L6 | opus-4-8 | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 4472.9 | 150.78 | 6.84 |
| L6 | opus-4-8 | T4 | 4 | 0 | 100 | 50 | — | 100 | 75 | 8 | 2558.5 | 52.24 | 6.13 |
| L6 | gpt-5.6-terra | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 251.8 | 16.63 | 0.77 |
| L6 | gpt-5.6-terra | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 914.8 | 44.86 | 1.06 |
| L6 | gpt-5.6-terra | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 2728.6 | 139.21 | 4.08 |
| L6 | gpt-5.6-terra | T4 | 4 | 0 | 100 | 50 | — | 75 | 75 | 8 | 2128.5 | 69.61 | 3.51 |
| L6 | gpt-5.6-terra | T5 | 5 | — | — | — | 100 | 80 | 60 | 10 | 881.6 | 30.08 | 2.29 |
| L6 | gpt-5.6-luna | T1 | 4 | — | 100 | 100 | 100 | 100 | 100 | 4 | 546.3 | 73.85 | 1.44 |
| L6 | gpt-5.6-luna | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1085.8 | 55.7 | 1.44 |
| L6 | gpt-5.6-luna | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 3868.4 | 142.03 | 5.41 |
| L6 | gpt-5.6-luna | T4 | 4 | 0 | 100 | 50 | — | 100 | 75 | 8 | 3295.1 | 116.56 | 4.76 |
| L6 | gpt-5.6-sol | T1 | 4 | — | 100 | 100 | 100 | 75 | 75 | 4 | 514.8 | 27.42 | 1.1 |
| L6 | gpt-5.6-sol | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1193.3 | 48.26 | 1.34 |
| L6 | gpt-5.6-sol | T3 | 4 | 0 | — | 0 | 100 | 100 | 100 | 8 | 3829.8 | 103.05 | 3.55 |
| L6 | gpt-5.6-sol | T4 | 4 | 0 | 100 | 50 | — | 75 | 75 | 8 | 3518.6 | 101.96 | 4.4 |
| L7 | sonnet-5 | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 246.8 | 16.78 | 0.91 |
| L7 | sonnet-5 | T2 | 4 | — | — | — | — | 50 | 50 | 4 | 960.3 | 24.17 | 1.13 |
| L7 | sonnet-5 | T3 | 4 | 0 | — | — | 100 | 100 | 100 | 8 | 4723.9 | 56.52 | 3.45 |
| L7 | sonnet-5 | T4 | 4 | 0 | 100 | — | — | 100 | 100 | 8 | 2406.8 | 40.54 | 3.59 |
| L7 | sonnet-5 | T5 | 5 | — | — | — | 100 | 100 | 80 | 10 | 1009.5 | 21.78 | 2.48 |
| L7 | fable-5 | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 251.8 | 18.59 | 3.01 |
| L7 | fable-5 | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 923.8 | 28.97 | 3.66 |
| L7 | fable-5 | T3 | 4 | 25 | — | — | 100 | 100 | 100 | 8 | 5079 | 156.4 | 12.79 |
| L7 | fable-5 | T4 | 4 | 0 | 100 | — | — | 100 | 100 | 8 | 3659.1 | 75.39 | 12.11 |
| L7 | haiku-4-5 | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 466.8 | 14.61 | 0.25 |
| L7 | haiku-4-5 | T2 | 4 | — | — | — | — | 50 | 50 | 4 | 1450.3 | 24.66 | 0.27 |
| L7 | haiku-4-5 | T3 | 4 | 0 | — | — | 50 | 100 | 50 | 8 | 5802.9 | 76.09 | 1.08 |
| L7 | haiku-4-5 | T4 | 4 | 0 | 100 | — | — | 100 | 75 | 8 | 1733.5 | 31.62 | 0.73 |
| L7 | opus-5 | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 263.8 | 13.2 | 1.64 |
| L7 | opus-5 | T2 | 4 | — | — | — | — | 75 | 75 | 4 | 1147 | 34 | 1.84 |
| L7 | opus-5 | T3 | 4 | 0 | — | — | 100 | 100 | 100 | 8 | 6734 | 95.26 | 6.28 |
| L7 | opus-5 | T4 | 4 | 0 | 100 | — | — | 100 | 75 | 8 | 3375 | 59.71 | 5.67 |
| L7 | opus-4-8 | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 269.3 | 13.55 | 1.6 |
| L7 | opus-4-8 | T2 | 4 | — | — | — | — | 75 | 75 | 4 | 1022.5 | 26.39 | 1.77 |
| L7 | opus-4-8 | T3 | 4 | 0 | — | — | 100 | 100 | 100 | 8 | 3477.6 | 60.78 | 4.78 |
| L7 | opus-4-8 | T4 | 4 | 0 | 100 | — | — | 100 | 100 | 8 | 2059.8 | 43.99 | 4.66 |
| L7 | gpt-5.6-terra | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 128.5 | 11.72 | 0.49 |
| L7 | gpt-5.6-terra | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1509.5 | 55 | 1.76 |
| L7 | gpt-5.6-terra | T3 | 4 | 100 | — | — | 100 | 100 | 100 | 8 | 7003.6 | 247.73 | 10.8 |
| L7 | gpt-5.6-terra | T4 | 4 | 100 | 100 | — | — | 75 | 50 | 8 | 4273 | 163.5 | 8.02 |
| L7 | gpt-5.6-terra | T5 | 5 | — | — | — | 100 | 80 | 40 | 10 | 989.8 | 30.32 | 2.09 |
| L7 | gpt-5.6-luna | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 196 | 12.81 | 0.75 |
| L7 | gpt-5.6-luna | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 902.3 | 35.64 | 1.03 |
| L7 | gpt-5.6-luna | T3 | 4 | 100 | — | — | 100 | 100 | 100 | 8 | 4651.8 | 117.25 | 4.92 |
| L7 | gpt-5.6-luna | T4 | 4 | 100 | 100 | — | — | 100 | 100 | 8 | 3453 | 91.51 | 4.46 |
| L7 | gpt-5.6-sol | T1 | 4 | — | 100 | — | 100 | 100 | 100 | 4 | 171.8 | 13.51 | 0.62 |
| L7 | gpt-5.6-sol | T2 | 4 | — | — | — | — | 100 | 100 | 4 | 1722 | 65.55 | 1.57 |
| L7 | gpt-5.6-sol | T3 | 4 | 100 | — | — | 100 | 75 | 50 | 8 | 5692.6 | 327.21 | 9.4 |
| L7 | gpt-5.6-sol | T4 | 4 | 100 | 100 | — | — | 75 | 75 | 8 | 4114.5 | 129.61 | 5.03 |

Every figure is regenerated from the recorded per-cell artifacts by one shared aggregation module. No individual transcripts or workspaces are included.
