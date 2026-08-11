import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  algorithmReadTotals,
  buildReportOutputs,
  CHART_CAPTIONS,
  divergingBarChart,
  groupedBarChart,
  niceMax,
  loadSections,
  modelFamily,
  parseSections,
  renderInline,
  renderMarkdownSubset,
  roundedPercent,
  simpleBarChart,
} from "../tools/BuildReportPage.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("report prose helpers", () => {
  test("renders the supported Markdown subset after escaping text", () => {
    const html = renderMarkdownSubset("<unsafe> **bold** *italic* `a < b` [link](https://example.test)\n\n- one\n- two\n\n1. first\n1. second\n\n| A | B |\n|---|---|\n| <x> | `y` |");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>a &lt; b</code>");
    expect(html).toContain('<a href="https://example.test"');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;x&gt;");
  });

  test("parses section ids, titles, and source order", () => {
    const sections = parseSections("<!--section: id=first title=First title-->\nHello\n<!--section: id=second title=Second title-->\nWorld");
    expect(sections.map(({ id, title }) => [id, title])).toEqual([["first", "First title"], ["second", "Second title"]]);
    expect(sections[0]!.bodyHtml).toContain("Hello");
    expect(sections[1]!.bodyHtml).toContain("World");
  });

  test("creates and loads placeholder sections when the source file is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lifeos-bench-report-"));
    temporaryDirectories.push(directory);
    const sections = await loadSections(join(directory, "nested", "report-sections.md"));
    expect(sections.map((section) => section.id)).toEqual(["summary", "general", "personalization", "algorithm", "cost", "limits", "method", "audit", "appendix"]);
    expect(sections.every((section) => section.bodyHtml === "<p>TODO</p>")).toBe(true);
  });
});

describe("report data derivation", () => {
  test("uses the configured engine rather than a model-name prefix for families", () => {
    expect(modelFamily({ id: "gpt-named-but-not-claudex", cli_arg: "x" })).toBe("Claude");
    expect(modelFamily({ id: "arbitrary-name", cli_arg: "x", engine: "claudex" })).toBe("GPT");
  });

  test("sums Algorithm-read totals from the supplied lane metrics", () => {
    expect(algorithmReadTotals([
      { version: "L7", algorithm_entry_pass: 1, algorithm_entry_total: 6 },
      { version: "L7", algorithm_entry_pass: 18, algorithm_entry_total: 42 },
      { version: "L6", algorithm_entry_pass: 0, algorithm_entry_total: 48 },
    ], "L7")).toBe("19/48");
  });
});

describe("inline SVG chart helpers", () => {
  function assertSvg(svg: string, bars: number) {
    expect(svg).toStartWith('<svg role="img"');
    expect(svg).toContain("<title");
    expect(svg).toContain('width="100%"');
    expect((svg.match(/<rect class="bar"/g) ?? []).length).toBe(bars);
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(svg).toContain("fill=\"var(--series-");
  }

  test("simple bar chart has one bar per value", () => {
    assertSvg(simpleBarChart("Simple", [{ label: "A", value: 1 }, { label: "B", value: 2 }]), 2);
  });

  test("grouped bar chart has a bar for every category-series value", () => {
    assertSvg(groupedBarChart("Grouped", ["A", "B"], [{ label: "RAW", values: [1, 2] }, { label: "L7", values: [3, 4] }]), 4);
  });

  test("diverging bar chart has one bar per delta", () => {
    assertSvg(divergingBarChart("Delta", [{ label: "A", value: -2 }, { label: "B", value: 3 }]), 2);
  });
});

test("rounds percentages to one decimal and represents a zero denominator as null", () => {
  expect(roundedPercent(6, 7)).toBe(85.7);
  expect(roundedPercent(1, 0)).toBeNull();
});

describe("wrapped block elements", () => {
  // Regression: prose wraps at 100 columns, so most list items span two source lines. The
  // renderer only consumed the first, and the continuation became an orphaned paragraph
  // immediately after the bullet — visible on the published page.
  test("a list item continued on an indented line stays one item", () => {
    const html = renderMarkdownSubset("- **First** claim that runs on to\n  a second line.\n- Second item.");
    expect(html).toBe("<ul><li><strong>First</strong> claim that runs on to a second line.</li><li>Second item.</li></ul>");
  });

  test("an ordered list keeps its continuation lines too", () => {
    const html = renderMarkdownSubset("1. One that wraps\n   onto the next line.\n2. Two.");
    expect(html).toBe("<ol><li>One that wraps onto the next line.</li><li>Two.</li></ol>");
  });

  test("a paragraph following a list is still its own block", () => {
    const html = renderMarkdownSubset("- Item.\n\nA following paragraph.");
    expect(html).toBe("<ul><li>Item.</li></ul>\n<p>A following paragraph.</p>");
  });
});

describe("grouped bar readability", () => {
  // Regression: four series per group put the value labels closer together than the text is
  // wide and they overprinted into an unreadable smear on the published page.
  test("crowded groups drop their value labels but keep a hover title per bar", () => {
    const svg = groupedBarChart("t", ["a", "b", "c", "d", "e", "f", "g", "h"],
      [1, 2, 3, 4].map((n) => ({ label: `s${n}`, values: [100, 100, 100, 100, 100, 100, 100, 100] })));
    expect(svg).not.toContain('class="chart-value"');
    expect(svg.match(/<rect/g) ?? []).toHaveLength(32);
    expect(svg.match(/<title>/g) ?? []).toHaveLength(33); // 32 bars + the chart's own title
  });

  test("a two-series chart keeps its value labels", () => {
    const svg = groupedBarChart("t", ["a", "b"], [{ label: "x", values: [10, 20] }, { label: "y", values: [30, 40] }]);
    expect(svg).toContain('class="chart-value"');
  });
});

describe("generated Markdown report", () => {
  function chartBlock(markdown: string, title: string): string {
    const start = markdown.indexOf(`### ${title}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = markdown.indexOf("\n### ", start + 4);
    return markdown.slice(start, end < 0 ? undefined : end);
  }
  function expectChartRow(markdown: string, title: string, row: unknown[]): void {
    expect(chartBlock(markdown, title)).toContain(`| ${row.map((value) => value ?? "—").join(" | ")} |`);
  }

  test("generates a GitHub-viewable report from the same data and prose as HTML", async () => {
    const { data, page, markdown } = await buildReportOutputs();
    const sections = await loadSections();
    const orderedTitles = sections.map((section) => `## ${section.title}`);
    const positions = orderedTitles.map((title) => markdown.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions.every((position, index) => index === 0 || position > positions[index - 1]!)).toBe(true);
    for (const section of sections) expect(markdown).toContain(section.bodyMarkdown);
    for (const caption of Object.values(CHART_CAPTIONS)) {
      expect(markdown).toContain(caption);
      expect(page.standalone).toContain(renderInline(caption));
    }

    expect(markdown).toContain(`| ${data.run.cells_total} | ${data.run.statuses.success ?? 0} | ${data.run.api_equivalent_cost_usd} | ${data.run.cumulative_cell_hours} |`);
    expect(markdown).toContain("### The complete prompt set");
    for (const prompt of data.generated.prompts) expect(markdown).toContain(`| ${prompt.tier} | ${prompt.id} |`);
    expect(markdown).toContain("### Every lane");
    expect(markdown).toContain("### Every lane by tier");

    const models = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
    const lane = (version: string, model: string) => data.lanes.find((entry) => entry.version === version && entry.model === model);
    const groupedRows = (pick: (entry: typeof data.lanes[number]) => number | null) => data.generated.versions.map((version) =>
      [version, ...models.map((model) => { const entry = lane(version, model); return entry ? pick(entry) : null; })]);
    const outcome = (version: string, scope: typeof data.outcome_summaries[number]["scope"]) => data.outcome_summaries.find((entry) => entry.version === version && entry.scope === scope);
    for (const version of data.generated.versions) {
      expectChartRow(markdown, "Task outcomes succeeding in at least one trial, by comparable scope", [version, outcome(version, "all eight models")?.at_k ?? null, outcome(version, "matched two-model pool")?.at_k ?? null, outcome(version, "T5 configured pool")?.at_k ?? null]);
      const matched = data.matched_versions.find((entry) => entry.version === version);
      expectChartRow(markdown, "Mean CLI-reported output tokens per matched cell", [version, matched?.output_tokens_mean ?? null, matched?.cells ?? null]);
    }
    for (const row of groupedRows((entry) => entry.format_pct)) expectChartRow(markdown, "Configured format marker found on selected checked prompts", row);
    for (const row of groupedRows((entry) => entry.algorithm_entry_pct)) expectChartRow(markdown, "Algorithm-directory Read observed on selected heavy prompts", row);
    for (const row of groupedRows((entry) => entry.algorithm_skip_pct)) expectChartRow(markdown, "No Algorithm-directory Read observed on selected trivial prompts", row);
    for (const row of data.raw_vs_l7) expectChartRow(markdown, "L7 minus RAW, T1–T4 outcomes succeeding in at least one trial (16 cases/model)", [row.model, row.prompt_model_cases, row.raw_pass, row.l7_pass, row.delta_pass, row.delta_at_k]);
    for (const [score, count] of Object.entries(data.judge.score_histogram)) expectChartRow(markdown, "Judge score distribution", [score, count]);

    expect(await readFile("docs/report.md", "utf8")).toBe(markdown);
    expect(markdown).not.toContain("<svg");
    expect((markdown.match(/^\*\*Chart data\*\*$/gm) ?? []).length).toBe(Object.keys(CHART_CAPTIONS).length);
  }, 30_000);
});

describe("report-accuracy semantic regressions", () => {
  test("keeps scoped outcomes, proxies, and limitations factual in both generated formats", async () => {
    const { data, page, markdown } = await buildReportOutputs();
    const outputs = [markdown, page.standalone, page.fragment];
    const defects = JSON.parse(await readFile("docs/defects.json", "utf8")) as { defects: Array<{ id: number; defect: string; effect: string }> };

    expect(defects.defects).toHaveLength(19);
    expect(defects.defects.map((defect) => defect.id)).toEqual(Array.from({ length: 19 }, (_, index) => index + 1));
    expect(defects.defects[0]!.defect).toContain("hook scripts/manifests");
    expect(defects.defects[0]!.effect).toContain("zero hooks registered in active settings.json");

    const sonnet = data.raw_vs_l7.find((row) => row.model === "sonnet-5")!;
    expect(sonnet.prompt_model_cases).toBe(16);
    expect(sonnet.raw_pass).toBe(15);
    expect(sonnet.l7_pass).toBe(14);
    expect(sonnet.delta_at_k_pp).toBe(-6.25);
    expect(sonnet.delta_at_k).toBe(-6.3);
    expect(data.raw_vs_l7.every((row) => row.prompt_model_cases === 16)).toBe(true);

    const summaries = (scope: typeof data.outcome_summaries[number]["scope"]) => data.outcome_summaries.filter((row) => row.scope === scope);
    expect(summaries("all eight models")).toHaveLength(3);
    expect(summaries("all eight models").every((row) => row.prompt_model_cases === 128 && row.version !== "L5")).toBe(true);
    expect(summaries("matched two-model pool")).toHaveLength(4);
    expect(summaries("matched two-model pool").every((row) => row.prompt_model_cases === 32)).toBe(true);
    expect(summaries("T5 configured pool").map((row) => [row.version, row.prompt_model_cases, row.at_k, row.all_k])).toEqual([
      ["RAW", 10, 40, 10], ["L5", 10, 100, 60], ["L6", 10, 90, 70], ["L7", 10, 90, 60],
    ]);

    expect(data.matched_versions.map((row) => [row.version, row.cells, row.output_tokens_mean])).toEqual([
      ["RAW", 68, 1941.1], ["L5", 68, 10906.4], ["L6", 68, 2035.9], ["L7", 68, 2626.9],
    ]);
    expect(data.algorithm_families.filter((row) => row.version === "L7").map((row) => [row.family, row.pass, row.total])).toEqual([["Claude", 1, 30], ["GPT", 18, 18]]);
    expect(data.hook_evidence.find((row) => row.version === "RAW")!.runtime_execution).toBe("Unavailable");
    for (const version of ["L5", "L6", "L7"]) {
      const lanes = data.lanes.filter((lane) => lane.version === version);
      expect(data.hook_evidence.find((row) => row.version === version)!.algorithm_directory_read)
        .toBe(`${lanes.reduce((total, lane) => total + lane.algorithm_entry_pass, 0)}/${lanes.reduce((total, lane) => total + lane.algorithm_entry_total, 0)}`);
    }
    const l5Terra = data.lanes.find((row) => row.version === "L5" && row.model === "gpt-5.6-terra")!;
    expect(l5Terra.algorithm_skip_pass).toBe(2);
    expect(l5Terra.algorithm_skip_total).toBe(4);

    for (const output of outputs) {
      expect(output).toContain("Algorithm-directory Read observed");
      expect(output).toContain("Configured format marker found on selected checked prompts");
      expect(output).toContain("cumulative cell-hours");
      expect(output).toContain("CLI-reported API-equivalent cost");
      expect(output).toContain("Marker scrubbing");
      expect(output).toContain("provenance");
      expect(output).toContain("score-three rejudge was not implemented");
      expect(output).toContain("memory, continuity, multi-turn");
      expect(output).toContain("long-term outcomes");
      expect(output).not.toContain("L6/L7 staged with zero hooks");
      expect(output).not.toContain("*unrouted*");
      expect(output).not.toContain("Eighteen defects");
      expect(output).not.toContain("L6 at 2.0k");
      expect(output).not.toContain("Every version passes the skip checks");
    }

    expect(markdown).toContain("T1–T4 ran across eight models; T5 ran only on Sonnet/Terra.");
    expect(page.standalone).toContain("T1–T4 ran across eight models; T5 ran only on Sonnet/Terra.");
    expect(markdown.indexOf("## Bottom line")).toBeLessThan(markdown.indexOf("## General single-turn tasks"));
    expect(markdown.indexOf("## General single-turn tasks")).toBeLessThan(markdown.indexOf("## The narrow personalization test"));
    expect(markdown.indexOf("## What this benchmark does not test")).toBeLessThan(markdown.indexOf("## What was tested and how"));
  }, 30_000);
});

describe("axis rounding", () => {
  // Regression: Math.ceil(max / 5) * 5 produced axes like 0 / 2727.5 / 5455 / 8182.5 / 10910
  // for token counts — correct, and unreadable.
  test("an axis maximum rounds up to a readable step", () => {
    expect(niceMax(10906.4)).toBe(12000);
    expect(niceMax(120)).toBe(120);
    expect(niceMax(34)).toBe(40);
    expect(niceMax(0.4)).toBe(0.4);
  });

  test("an empty or non-positive maximum never yields a zero-height axis", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });

  test("the axis maximum is never below the data it must fit", () => {
    for (const value of [1, 7, 23, 99, 101, 2035.9, 10906.4]) expect(niceMax(value)).toBeGreaterThanOrEqual(value);
  });
});
