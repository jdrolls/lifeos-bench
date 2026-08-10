<!--section: id=question title=The question-->
AI "scaffolding" frameworks — layered system prompts, always-on context files, hooks that gate
and reroute the model — are argued about far more than they are measured. The argument that
started this one is [LifeOS discussion #1715](https://github.com/danielmiessler/LifeOS/discussions/1715):
does the framework actually improve outcomes, on which models, at what token cost?

That question cannot be settled by reading the framework. It needs an experiment with a control.

This is that experiment. Three released versions of one real framework, plus a bare control that
has none of it, run across eight models on a frozen set of prompts, graded by code where the
answer is checkable and by blinded cross-vendor judges where it is not.

Two things are being asked, and they are not the same question:

- **Does the scaffolding help?** Compare each scaffolded lane against the bare control on the
  same model, same prompt, same harness.
- **Where does it stop helping?** Compare across model tiers and across framework versions. A
  scaffold that lifts a mid-tier model and does nothing for a frontier one is a different claim
  from a scaffold that lifts everything.

<!--section: id=method title=How it was measured-->
Every cell is one `(version, model, prompt, trial)`. Nothing is compared across harnesses: the
GPT lanes run through the *same* Claude Code harness via a local ChatGPT-auth proxy, so the hooks
fire identically and the only difference is the model.

### The scaffolds

`RAW` is the control — bare Claude Code with an empty config: no framework file, no imports, no
hooks. `L5`, `L6` and `L7` are three released versions of the framework, staged from their own
upstream checkouts and activated by their own installers, not by a reimplementation.

### The prompts

Twenty-one prompts, frozen as golden set 2.0.0, in five tiers:

| Tier | What it probes |
|---|---|
| T1 | simple assistant tasks — a fact, a one-line edit, an acknowledgement |
| T2 | medium coding — a bug fix with a failing test, a script, a data question |
| T3 | complex work — build, debug across modules, refactor, plan |
| T4 | routing traps — casual phrasing hiding real scope, formal phrasing hiding triviality |
| T5 | personalization — does the answer use the user's actual profile, or invent one |

The persona used in T5 is synthetic and disjoint from the operator by construction, which turns
the operator's own identifiers into a continuous tripwire: if any of them appear in a transcript,
a cell escaped its sandbox and the containment gate invalidates it.

### Three columns, never averaged together

Grading keeps **routing**, **format compliance** and **task success** in separate columns.
Collapsing the first two produced a headline that had to be retracted: one version deliberately
removed its output modes, and a metric that grepped for mode banners scored it zero for a
feature it had deleted on purpose.

- **Routing** asks a behavioural question — did the scaffold read its own Algorithm before
  substantial work — so it means the same thing across versions that disagree about whether
  modes exist at all.
- **Format compliance** checks each version's own documented output contract.
- **Task success** is everything checkable: tests pass, exact outputs, files changed or left
  alone, tool-call and token budgets.

Where an answer is not mechanically checkable, an LLM judge scores it against a rubric.
**Judges are blinded and cross-vendor**: banner lines are stripped before the judge sees the
response, Claude-family cells are judged by GPT, GPT cells by Claude. Nothing self-grades. The
Claude-side judge runs with an empty config *and* a neutral working directory — both load-bearing,
because Claude Code derives context from the working directory as well as from `HOME`, and an
unisolated judge grades synthetic-persona answers against the operator's real profile.

### Isolation, and what "hooks on" means

Each cell gets its own `$HOME`, cloned from a staged template that the seatbelt grants no write
access, so one cell's hooks cannot carry state into the next. A `sandbox-exec` profile denies the
operator's home outright. Cells run with their working directory outside that tree — not tidiness:
a Bun process whose cwd sits inside the denied subtree starts with a completely empty environment,
and every framework hook is a Bun script, so the entire enforcement layer was silently dead until
this was found.

Because that failure was invisible in the artifacts, every cell now **records what its hooks
wrote**: the list of paths touched inside its private `$HOME` (`home-writes.txt`), the files
themselves (`home-state/`), and a count in `meta.json`. "The enforcement layer ran" is now a
number in the dataset rather than a claim in a README.

<!--section: id=run title=What was actually run-->
560 cells. 559 succeeded. The single failure is a reproducible 20-minute timeout on one control
cell — it failed twice, the second time on an otherwise idle machine — and it is recorded as a
timeout rather than rescued by raising the ceiling mid-analysis.

Every scaffolded cell in this dataset ran with a working hook layer, and the evidence is in the
data rather than in this sentence: the enforcement layer wrote a mean of 22 to 25 state files per
cell, and the control wrote none, because it registers no hooks. The control's cells are retained
from the previous run on a stated argument rather than re-executed — a version with no hooks has
nothing writing to `$HOME` at runtime, and every cell already had a unique working directory, so
no session could be resumed into another cell.

Judging is complete: 220 rubric verdicts, zero judge errors, zero rows left unjudged.

**Read the lane tables with their `Prompts` column.** The personalization tier runs on two models
by design, so six of the eight model lanes were scheduled for 16 prompts and two for 21. Compare
a lane against the same model's other lane, never against a lane with a different denominator.

<!--section: id=findings title=Findings-->
The scaffolding's measurable benefit is concentrated almost entirely in the one thing it uniquely
supplies — knowledge of the user — and is neutral-to-slightly-negative everywhere else.

### On general tasks the scaffolding does not help

Across the four non-personalization tiers, on the two models every version ran:

| Version | T1–T4 pass@k | T1–T4 pass^k |
|---|---:|---:|
| RAW (control) | **96.9%** | 93.8% |
| L5 | 96.9% | 90.6% |
| L6 | 93.8% | 93.8% |
| L7 | 90.6% | 87.5% |

The six-model sweep says the same thing with more samples: on T1–T4 the control reaches 95.8%
pass@k and the newest version 93.8%. Nothing here is outside the noise this trial count can
resolve — but nothing here is a gain either, and the direction is consistent.

### On personalization the scaffolding is decisive

Same two models, same harness, the tier that asks whether the answer uses the user's actual
profile:

| Version | T5 pass@k | T5 pass^k |
|---|---:|---:|
| RAW (control) | **40.0%** | 10.0% |
| L5 | 100.0% | 60.0% |
| L6 | 90.0% | 70.0% |
| L7 | 90.0% | 60.0% |

This is the one place the effect is large, consistent across all three versions and both models,
and mechanistically obvious: the control structurally cannot know the persona. It is worth
stating plainly that this is close to a tautology — the scaffold wins the tier that measures
whether the scaffold's contents were used. What the tier does establish is that the delivery
mechanism *works*: the profile reaches the model and changes the answer.

### The bare control is much stronger than the earlier write-up claimed

Four of eight models reach **100% pass@k with no scaffolding at all** on the prompts they ran.
The previously published claim that no model passes 100% bare was an artifact of counting five
personalization prompts against six lanes that were never scheduled to run them — see the
corrections below.

### Per-model, newest version minus control

The delta swings both ways and does not sort by model tier: the largest gain is on a mid-tier
model, the largest loss on the most expensive reasoning lane. With one or two trials per prompt,
a swing of one prompt is 4.8 to 6.3 points — so treat everything inside that band as noise and
only the two outer bars as signal.

### Cost is where the versions genuinely separate

L5 spends about **10.9k output tokens per cell**; L6 spends 2.0k and L7 2.9k, and the control
2.8k. That is a 4–5× premium for a task pass-rate inside the noise band, and it is the clearest
version-over-version finding in the dataset. Format compliance moves the other way and is the
one place the framework's newer versions demonstrably improve on the older: 70% under L5, 100%
under L6, 96% under L7 — the last figure dragged down entirely by one small model at 67%.

### Routing measures instruction-following, not enforcement

Read the routing column with the limitation attached to it: the version with a classifier hook
cannot authenticate inside the sandbox, and the newest version has no classifier at all. What
the column actually shows is whether the model followed a written instruction to read the
framework's Algorithm first — and the split is by vendor, not by version. Under the newest
version, all three GPT lanes read it 100% of the time; the Claude lanes 40–50%.

<!--section: id=reading title=How to read these numbers-->
Each metric licenses a narrow claim. The wide version of that claim is usually wrong.

| Metric | What it means | What it does **not** license |
|---|---|---|
| **pass@k** | the prompt passed on at least one trial | that the lane is reliable — with two trials, pass@k rewards a coin flip that came up once |
| **pass^k** | the prompt passed on *every* trial | that it would pass a third time; two trials is not a stability measurement |
| **Routing** | the scaffold read its Algorithm before substantial work | anything about hook-based routing, which this method cannot measure at all |
| **Format** | the version honoured its own documented output contract | quality — a perfectly formatted wrong answer scores 100% here |
| **Output tokens** | mean tokens the model generated per cell | total cost of ownership; input context and cache traffic are not in this column |
| **Hook files written** | how much runtime state the enforcement layer wrote | that the enforcement layer *helped* — it is evidence the layer ran, nothing more |
| **Wall-clock** | mean seconds per cell | a latency comparison; cells ran concurrently and contended for CPU |

Two structural cautions apply to every number on this page:

1. **A skipped check is not a failure.** The control structurally cannot know the synthetic
   persona, so its personalization checks are skipped by design and excluded from both the
   numerator and the denominator. Counting them as failures would have manufactured a scaffold
   advantage out of the control's exemption.
2. **The judge bar is permissive.** A rubric passes at 3 of 5, and most scores are 5s, so task
   pass-rate separates versions weakly. Differences of one prompt are noise, not a result.

<!--section: id=corrections title=What went wrong, and how it was caught-->
This is the part of the study worth reading first. A benchmark's credibility does not come from
the absence of errors; it comes from how its own errors were caught, and from what happens to the
numbers that were already published when they are.

### Phases 1–3 are retracted in full

432 completed runs, discarded. Three independent faults, each sufficient alone:

1. **Sandbox escape.** Cells swapped the config directory but not `$HOME`, so the thousands of
   home-relative references inside every scaffold resolved to the operator's live install. Nearly
   half the published transcripts contained operator-tree content — including the *control*,
   which read the operator's framework doctrine as its first action. A control that reads the
   scaffold is not a control.
2. **The scaffolded lanes were under-installed.** The file carrying each version's response
   format and verification doctrine was never loaded, and the one attempt to activate the
   Algorithm pointed at a path that silently did not resolve.
3. **The routing metric measured a retired feature.** It grepped for mode banners against a
   version whose own documentation says the modes were deleted.

Faults 2 and 3 compound: with no Algorithm to load, the newest version went looking for one
outside its sandbox, which is fault 1.

### Phase 4's scaffolded lanes are superseded

The next run was clean on all three counts and still measured the wrong thing. **Every scaffolded
cell ran with its hook layer disabled** — the seatbelt's home read-deny emptied the environment of
every Bun hook process. What survived was the prompt-and-context half of each framework; what was
switched off was the enforcement half. For a framework whose founding principle is "code before
prompts", that understates it in an unknown direction.

The control is unaffected, because it registers no hooks.

### Turning the hooks on took three fixes, and each of the first two hid the next

1. **The working directory.** Cwd inside the seatbelt's denied home emptied `process.env` for
   every Bun hook. Fixed by running cells outside that tree.
2. **Missing dependencies.** No staged install had `node_modules`, so hooks importing a YAML
   parser died trying to write a tempdir the seatbelt refused. Fixed by installing dependencies
   at staging time.
3. **A shared staged home.** With hooks finally running, they wrote their runtime state back into
   the single staged install every cell in the lane loaded — drift reminders, work state, session
   names, and in one version the settings file itself. Cell N's context depended on what cell N−1
   left behind, and under concurrency they raced. Fixed by giving every cell its own clone and
   denying the template any write access.

Nothing before fix 3 is a valid scaffolded measurement. The first two fixes did not make the layer
work; they only exposed the next fault.

### Two grader defects found while writing this page

Both were one-directional — each could only ever move the numbers one way — and both were caught
by asking why a figure looked wrong rather than by a test.

1. **A `skipped` check counted as a failure.** The golden set skips checks that cannot apply to a
   version; the control's personalization checks are skipped because it cannot know the persona.
   Counting them as failures turned a documented exemption into a penalty, and only the control
   was ever exempt.
2. **Prompts a lane never ran counted against it.** The personalization tier runs on two models by
   design, but pass-rate divided by all 21 prompts regardless — so six of the eight model lanes
   were graded on five prompts that were never sent to them. It cost a restricted lane up to 23.8
   points and it is the sole source of the retracted claim that no model passes 100% bare.

Both are fixed, both have regression tests, and both are in the table below. The second is the
more instructive: the number it produced was quoted as a headline finding for a full phase.

<!--section: id=limitations title=Limitations-->
Stated plainly, because the alternative is having them discovered by a reader.

- **Trial counts are low.** Most cells are one or two trials. Format compliance has been observed
  varying run to run on an identical lane. Nothing here has five-trial confirmation.
- **The judge bar is permissive, and demonstrably so.** A rubric passes at 3 of 5. Scores are
  bimodal — 120 fives and 34 ones out of 220 — but the 35 threes are all admitted, and at least
  one of them is a verdict whose own reasoning says the response *failed* the thing the rubric
  asked about: it scored a 3, and passed, while the judge wrote that the answer "does not
  acknowledge the standing preference". Raising the threshold to 4 would reclassify 16% of all
  verdicts, which is larger than most of the version differences on this page.
- **Cells could open tabs in the operator's own browser.** A cell that renders a page launches a
  browser through the OS, which runs outside the seatbelt; leftover tabs pointing at cell
  workspaces were found in the operator's browser session. Nothing flows back into the cell — the
  boundary that matters for validity held, and containment scans clean — but "the cell cannot
  affect the host" is not a claim this harness can make.
- **Hook-based routing is structurally unmeasurable here.** One version's router spawns a nested
  model call; the harness passes no credential into a sandbox by design, so that call cannot
  authenticate. This is a deliberate isolation invariant, not a defect awaiting a fix — and it
  means the routing column measures *unrouted* model behaviour for that version. The newest
  version has no router at all. Read the routing column as instruction-following, not enforcement.
- **Wall-clock is not comparable** at concurrency greater than one; cells contend for CPU.
  Token counts, routing, format and pass-rates are unaffected.
- **The control is bare of this framework, not of all scaffolding.** It still has the CLI's
  bundled skills; one cell was observed invoking one of them.
- **The control's cells were retained, not re-run**, on the argument stated above. If that
  argument is ever doubted, the remedy is to re-run the control, not to hedge the numbers.
- **A fresh install of two of the versions reports its own memory hooks as missing** — an upstream
  packaging mismatch that puts a `CRITICAL` health banner into the model's context and sometimes
  into its answer. Faithfully reproduced upstream behaviour, but it consumes context and shows up
  in graded output.

<!--section: id=appendix title=Appendix — full tables-->
Every number on this page is regenerated from the recorded per-cell artifacts by a single
aggregation module, so the tables below and the charts above cannot disagree.
