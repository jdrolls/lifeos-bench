<!--section: id=question title=The question LifeOS #1715 asked-->
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

<!--section: id=design title=Exactly what was tested-->
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

<!--section: id=degraded title=Has LifeOS degraded?-->
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

<!--section: id=algorithm title=Does the Algorithm still fire — and does that depend on the model?-->
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

<!--section: id=versions title=Was an earlier version better?-->
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

<!--section: id=models title=What this says about models, frameworks, and where the value is-->
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

<!--section: id=unmeasured title=What this benchmark cannot see-->
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

<!--section: id=conclusions title=Conclusions-->
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

<!--section: id=caveats title=How much weight these numbers carry-->
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

<!--section: id=appendix title=Appendix-->
Every figure on this page is regenerated from the recorded per-cell artifacts by one shared
aggregation module, so the charts, the tables and the Markdown report cannot disagree. The harness,
the frozen prompt set, and step-by-step instructions for reproducing this — or for pointing it at
your own framework — are in the repository.
