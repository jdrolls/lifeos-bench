<!--section: id=summary title=Bottom line-->
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

<!--section: id=general title=General single-turn tasks-->
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

<!--section: id=personalization title=The narrow personalization test-->
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

<!--section: id=algorithm title=What the Algorithm-read proxy observed-->
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

<!--section: id=cost title=Output volume and run accounting-->
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

<!--section: id=limits title=What this benchmark does not test-->
This is a cold-start, single-turn benchmark. It does **not** test memory, continuity, multi-turn
collaboration, accumulated context, or long-term outcomes.

It also does not establish the value of work artifacts reused later, relationship/voice over time,
skill and delegation systems at scale, credential-dependent automation, or whether LifeOS helps a
person reach durable real-world goals. Those need longitudinal and multi-turn experiments.

<!--section: id=method title=What was tested and how-->
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

<!--section: id=audit title=Caveats and corrected defects-->
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

<!--section: id=appendix title=Detailed data and glossary-->
The detailed lane and tier tables preserve version-wide operational rollups for inspection. They are
not a license to rank versions from heterogeneous two-model and eight-model pools.

“Succeeded in at least one trial” and “succeeded in every trial” are the plain-language labels used
in the narrative. The glossary retains the mathematical aliases only as data-key definitions.
