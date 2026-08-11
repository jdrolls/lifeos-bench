# Does LifeOS actually help?

T1–T4 ran across eight models; T5 ran only on Sonnet/Terra. Three released LifeOS versions were measured against a bare control on a frozen 21-prompt set · golden set 2.0.0 · aggregate results only

## Bottom line

**No consistent observed general-task improvement in this sample.** On the five synthetic-profile prompts,
LifeOS showed a large observed advantage, but that result was tested only with Sonnet and Terra.

Under L7, an **Algorithm-directory `Read` observed** on selected heavy-task attempts was 1/30 for
Claude lanes and 18/18 for GPT lanes. That proxy does not prove that an Algorithm run started,
preceded substantive work, or was followed.

> **Confidence box.** Most prompt/model pairs have one or two trials; model coverage differs by
> version; the judge passes a permissive 3/5 floor; retained RAW cells differ from later cells in
> per-cell HOME capture/isolation; L6 routing failed authentication and selected an explicit
> `NATIVE` fail-safe for short prompts; and RAW is a minimal LifeOS-free Claude Code configuration,
> not an empty program.

## General single-turn tasks

The general-task comparison is deliberately split by shared scope. RAW, L6, and L7 each have 128
T1–T4 prompt-model cases across eight models. The matched Sonnet/Terra pool has 32 cases per
version, including L5. Those are separate comparisons, not one leaderboard with unequal coverage.

| Scope | RAW | L5 | L6 | L7 |
|---|---:|---:|---:|---:|
| T1–T4, all eight models — succeeded in at least one trial | 96.1% | — | 91.4% | 93.0% |
| T1–T4, matched Sonnet/Terra — succeeded in at least one trial | 96.9% | 96.9% | 93.8% | 90.6% |

No confidence interval was estimated. The observed differences do not establish a consistent
benefit or a causal version trend.

The format proxy is also narrow: it finds a configured marker somewhere in a selected final message
with an unanchored regex. It does not establish first-line placement or whole-version compliance.

### Task outcomes succeeding in at least one trial, by comparable scope

Each scope has its own denominator: 128 all-eight T1–T4 prompt-model cases where available, 32 matched two-model T1–T4 cases, and 10 configured-pool T5 cases. They are never pooled across unequal lane sets.

**Chart data**

| Version | T1–T4 all eight % | T1–T4 matched % | T5 configured-pool % |
| --- | --- | --- | --- |
| RAW | 96.1 | 96.9 | 40 |
| L5 | — | 96.9 | 100 |
| L6 | 91.4 | 93.8 | 90 |
| L7 | 93 | 90.6 | 90 |

### Comparable outcome summaries

| Version | Scope | Tiers | Prompt-model cases | Succeeded in at least one trial | Succeeded in every trial | At least one trial % | Every trial % |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | all eight models | T1–T2–T3–T4 | 128 | 123 | 118 | 96.1 | 92.2 |
| RAW | matched two-model pool | T1–T2–T3–T4 | 32 | 31 | 30 | 96.9 | 93.8 |
| RAW | T5 configured pool | T5 | 10 | 4 | 1 | 40 | 10 |
| L5 | matched two-model pool | T1–T2–T3–T4 | 32 | 31 | 29 | 96.9 | 90.6 |
| L5 | T5 configured pool | T5 | 10 | 10 | 6 | 100 | 60 |
| L6 | all eight models | T1–T2–T3–T4 | 128 | 117 | 113 | 91.4 | 88.3 |
| L6 | matched two-model pool | T1–T2–T3–T4 | 32 | 30 | 30 | 93.8 | 93.8 |
| L6 | T5 configured pool | T5 | 10 | 9 | 7 | 90 | 70 |
| L7 | all eight models | T1–T2–T3–T4 | 128 | 119 | 113 | 93 | 88.3 |
| L7 | matched two-model pool | T1–T2–T3–T4 | 32 | 29 | 28 | 90.6 | 87.5 |
| L7 | T5 configured pool | T5 | 10 | 9 | 6 | 90 | 60 |

### Configured format marker found on selected checked prompts

Configured marker found by the selected-prompt, unanchored full-message regex. The control has no configured marker, so it has no bar.

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 60 | — | — | — | — | 80 | — | — |
| L6 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| L7 | 100 | 100 | 66.7 | 100 | 100 | 100 | 100 | 100 |

## The narrow personalization test

T5 is the narrow test of whether a supplied synthetic profile changes a one-turn answer. It ran only
on Sonnet and Terra: 10 prompt-model cases per version, with two trials per prompt.

| Version | Succeeded in at least one trial | Succeeded in every trial |
|---|---:|---:|
| RAW | 40% | 10% |
| L5 | 100% | 60% |
| L6 | 90% | 70% |
| L7 | 90% | 60% |

This is a **large observed advantage in a five-prompt, two-model test**. It supports that the
scaffold supplied useful profile information in this setup; it does not measure long-term
personalization or establish performance on other models.

## What the Algorithm-read proxy observed

**Algorithm-directory `Read` observed** is a transcript proxy. `code:algorithm_read` detects any
`Read` tool call whose `file_path` contains the configured Algorithm directory. It does not prove
that the read was first, preceded substantive work, opened an ISA/run, or that the Algorithm was
followed or completed.

L6 hook scripts were present, actively registered, and executed. `TheRouter` uses fast paths and
cache before classifier inference. Its nested classifier could not authenticate in this sandbox;
on the benchmark’s sub-400-character heavy prompts, its explicit fail-safe selected `NATIVE`.
That is routed fail-safe behavior, not an absence of routing. The system prompt also contained
missing-MODE and contextual fallback language.

L7 had six registered and executed prompt-submit hooks, but none classified prompts or forced
Algorithm entry. `AlgorithmNudge` is advisory. `PromptProcessing` still performs separate
inference for naming/title behavior, so the L7 hook set is not wholly model-free. The different L5
and L7 wording is an explanatory **hypothesis**, not an established cause; test it with a controlled
wording ablation.

The family totals below are derived from the recorded lane metrics, not copied into prose. L7 is
Claude 1/30 and GPT 18/18.

### Algorithm-read totals by model family

| Version | Model family | Algorithm-directory Reads observed | Share % |
| --- | --- | --- | --- |
| L5 | Claude | 5/6 | 83.3 |
| L5 | GPT | 6/6 | 100 |
| L6 | Claude | 0/30 | 0 |
| L6 | GPT | 0/18 | 0 |
| L7 | Claude | 1/30 | 3.3 |
| L7 | GPT | 18/18 | 100 |

### Algorithm-directory Read observed on selected heavy prompts

Three heavy prompts × two trials = six checks per model. L6 is 0 of 6 across every model, but its nested classifier cannot authenticate in the sandbox. L7 has no classifier: its Algorithm-read totals are Claude 1/30 and GPT 18/18.

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 83.3 | — | — | — | — | 100 | — | — |
| L6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| L7 | 0 | 16.7 | 0 | 0 | 0 | 100 | 100 | 100 |

### No Algorithm-directory Read observed on selected trivial prompts

The opposite check on trivial work is reported separately; combining it with Algorithm entry would hide the entry result.

**Chart data**

| Version | sonnet-5 | fable-5 | haiku-4-5 | opus-5 | opus-4-8 | gpt-5.6-terra | gpt-5.6-luna | gpt-5.6-sol |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RAW | — | — | — | — | — | — | — | — |
| L5 | 100 | — | — | — | — | 50 | — | — |
| L6 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |
| L7 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

## Output volume and run accounting

The matched Sonnet/Terra pool supplies 68 recorded cells per version. Its mean CLI-reported output
tokens per cell were RAW **1941.1**, L5 **10906.4**, L6 **2035.9**, and L7 **2626.9**. L5 generated
substantially more output on this shared pool.

The run’s 20.38 **cumulative cell-hours** sum per-cell durations; concurrent execution means it is
not elapsed wall time. The $474.63 figure is **CLI-reported API-equivalent cost**, not an invoice or
subscription charge. Full-matrix totals remain descriptive operational data, not a matched outcome
comparison.

For per-model RAW/L7 deltas, every row uses the same 16 T1–T4 prompt-model cases. Percentage-point
deltas are calculated from integer pass counts before display rounding; Sonnet is 14/16 versus
15/16, or −6.25 points before display rounding.

### Mean CLI-reported output tokens per matched cell

CLI-reported output-token proxy for the 68 cells shared by every version (the configured two-model T5 pool across all tiers). It is not a provider invoice.

**Chart data**

| Version | Tokens mean | Matched cells |
| --- | --- | --- |
| RAW | 1941.1 | 68 |
| L5 | 10906.4 | 68 |
| L6 | 2035.9 | 68 |
| L7 | 2626.9 | 68 |

### L7 minus RAW, T1–T4 outcomes succeeding in at least one trial (16 cases/model)

Count-derived difference on the same 16 T1–T4 prompt outcomes per model: positive means L7 passed more outcomes than RAW.

**Chart data**

| Model | Prompt-model cases | RAW pass | L7 pass | Delta passes | Delta pp |
| --- | --- | --- | --- | --- | --- |
| sonnet-5 | 16 | 15 | 14 | -1 | -6.3 |
| fable-5 | 16 | 16 | 16 | 0 | 0 |
| haiku-4-5 | 16 | 14 | 14 | 0 | 0 |
| opus-5 | 16 | 16 | 15 | -1 | -6.3 |
| opus-4-8 | 16 | 14 | 15 | 1 | 6.3 |
| gpt-5.6-terra | 16 | 16 | 15 | -1 | -6.3 |
| gpt-5.6-luna | 16 | 16 | 16 | 0 | 0 |
| gpt-5.6-sol | 16 | 16 | 14 | -2 | -12.5 |

## What this benchmark does not test

This is a cold-start, single-turn benchmark. It does **not** test memory, continuity, multi-turn
collaboration, accumulated context, or long-term outcomes.

It also does not establish the value of work artifacts reused later, relationship/voice over time,
skill and delegation systems at scale, credential-dependent automation, or whether LifeOS helps a
person reach durable real-world goals. Those need longitudinal and multi-turn experiments.

## What was tested and how

The benchmark records 704 cells from four configurations: minimal LifeOS-free Claude Code
configuration (RAW), PAI v5.0.0 (L5), LifeOS v6.0.5 (L6), and LifeOS v7.28.3 (L7). T1–T4 ran across
eight models; T5 ran only on the configured Sonnet/Terra pool. Each release used a pinned payload,
selected upstream activation/hook tools, and harness-managed configuration/dependencies — not an
installer-only characterization of the setup.

Code graders cover checkable claims. For judged work, configured cross-vendor passes are separate.
Framework-marker lines are scrubbed before judging, which is not guaranteed complete blinding. The
existing judge rows carry no provider/model provenance, and no alternate-vendor rejudge was
implemented for score-three verdicts despite the frozen rubric’s stated protocol. The headline
threshold is 3/5; sensitivity to that permissive floor belongs beside the findings, not hidden in an
appendix.

The method tables below provide the version matrix, trials, prompt table, run accounting, and the
five-way hook evidence distinction: payload presence, active registration, runtime evidence,
routing responsibility, and observed Algorithm-directory reads. Captured filesystem writes are
consistent with hook activity, but are not invocation counts or proof every hook succeeded. RAW
runtime capture is unavailable, not zero.

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

| Recorded cells | Successful cells | CLI-reported API-equivalent cost USD | Cumulative cell-hours |
| --- | --- | --- | --- |
| 704 | 703 | 474.63 | 20.38 |

| Version | Cells | Statuses |
| --- | --- | --- |
| RAW | 212 | success: 211, timeout: 1 |
| L5 | 68 | success: 68 |
| L6 | 212 | success: 212 |
| L7 | 212 | success: 212 |

### Hook evidence

| Version | Hook payload present | Active registration present | Runtime execution evidence | Routing responsibility | Algorithm-directory Read observed |
| --- | --- | --- | --- | --- | --- |
| RAW | No LifeOS payload | No LifeOS registration | Unavailable | None | Not applicable |
| L5 | Present | Present | Captured state files | Prose instruction, not a routing hook | 11/12 |
| L6 | Present | Present | Observed | TheRouter classifier | 0/48 |
| L7 | Present | Six prompt-submit hooks | Observed | None; AlgorithmNudge is advisory | 19/48 |

## Caveats and corrected defects

One prompt/model outcome moves the all-eight T1–T4 aggregate by 0.8 points, yet that aggregate is
still heterogeneous model coverage rather than repeated independent trials. No confidence interval
or formal significance test was estimated.

The judge floor is permissive: a 3/5 score passes. Marker scrubbing is narrower than complete
blinding, provenance is absent in recorded judge rows, and the frozen rubric’s alternate-vendor
score-three rejudge was not implemented. Treat threshold sensitivity as a limitation of every
headline task outcome.

Retained RAW cells predate the final per-cell HOME capture/isolation approach. L6’s classifier
failure and explicit short-prompt `NATIVE` fail-safe confound any interpretation of its
Algorithm-read proxy as routing quality. L5 Terra’s Algorithm-skip result is the documented 2/4
exception; skip is separate because it asks the opposite question, not because it universally
passes.

Nineteen unique defects are recorded below. Fixes use targeted regression tests where practical and
fail-loud assertions or explicit publication caveats otherwise. The four live lane roots each pass
`LeakCheck` with zero violations; a whole `results/` scan still fails on 101 retired FORK artifacts
that remain in ignored duplicate paths, so it is not presented as a clean whole-tree gate.

### Judge score distribution

Scores are bimodal, and the pass bar is 3 of 5 — so every score of 3 counts as a pass.

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
| 1 | Pre-fix L6/L7 staging copied hook scripts/manifests without active settings registration | Those discarded runs had hook payloads but zero hooks registered in active settings.json, so they could not measure hook-enforced behavior. The published rerun registered and executed the hooks. |
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
| 18 | Retired-lane artifacts coexist with the live results tree | Retired FORK artifacts legitimately contain real identity. Each live lane root scans clean, but a whole results/ LeakCheck still reports 101 violating files because ignored retired copies remain there as well as in _archive. Publication verification must scan the explicit live lane roots until those duplicate retired paths are cleaned up. |
| 19 | Algorithm entry averaged with Algorithm skip | code:algorithm_read asks opposite questions on opposite prompts — observe an Algorithm-directory Read for heavy work, or no such Read for selected trivial work. A single combined column diluted the heavy-task result toward the trivial-task result. Split into separate columns keyed on the golden set's own expect field; L5 Terra remains the documented 2/4 skip exception. |

## Detailed data and glossary

The detailed lane and tier tables preserve version-wide operational rollups for inspection. They are
not a license to rank versions from heterogeneous two-model and eight-model pools.

“Succeeded in at least one trial” and “succeeded in every trial” are the plain-language labels used
in the narrative. The glossary retains the mathematical aliases only as data-key definitions.

### Metric glossary

| Data key | Meaning |
| --- | --- |
| algorithm_entry_pct | Share of selected heavy prompt opportunities where an Algorithm-directory Read was observed. This transcript proxy does not establish read order, an ISA/run, or Algorithm completion. |
| algorithm_skip_pct | Share of selected trivial prompt opportunities where no Algorithm-directory Read was observed. This asks the opposite question from the heavy-task proxy and is reported separately; L5 Terra is the documented 2/4 exception. |
| mode_marker_pct | Share of responses carrying the version's own documented mode banner. Null for versions that ship no modes. |
| format_pct | Configured format marker found on selected checked prompts. The grader searches the full final message with an unanchored regex; this does not establish first-line placement or whole-version compliance. |
| task_at_k_pct | Share of scheduled task prompts with at least one passing trial. |
| task_all_k_pct | Share of scheduled task prompts whose trials all passed. |
| task_prompts | Prompts this lane was scheduled to run — restricted tiers are absent from the lanes that never ran them, so this is the pass-rate denominator. |
| cells | Cells with a readable meta.json record. |
| statuses | Histogram of meta.status values. |
| output_tokens_mean | Mean CLI-reported output tokens per recorded cell; a usage proxy, not billed usage. |
| wall_clock_mean_s | Mean recorded wall-clock seconds per cell; concurrent cells make it non-comparable as elapsed time. |
| cost_usd_total | CLI-reported API-equivalent cost in US dollars; not an invoice or subscription charge. |
| hook_files_mean | Mean captured hook-state files written where recorded; this does not prove every registered hook executed or routed. |

### Every lane

| Version | Model | Prompts | Algorithm-directory Read observed % | No Algorithm-directory Read observed % | Mode markers % | Format marker found % | Task @k % | Task all-k % | Cells | Tokens mean | Wall s mean | Cost USD | Hook files mean | Statuses |
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

| Version | Model | Tier | Prompts | Algorithm-directory Read observed % | No Algorithm-directory Read observed % | Mode markers % | Format marker found % | Task @k % | Task all-k % | Cells | Tokens mean | Wall s mean | Cost USD |
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
