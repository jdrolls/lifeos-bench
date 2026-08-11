import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildReportOutputs,
  CHART_CAPTIONS,
  divergingBarChart,
  groupedBarChart,
  niceMax,
  loadSections,
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
    expect(sections.map((section) => section.id)).toEqual(["question", "design", "degraded", "algorithm", "versions", "models", "unmeasured", "conclusions", "caveats", "appendix"]);
    expect(sections.every((section) => section.bodyHtml === "<p>TODO</p>")).toBe(true);
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

    expect(markdown).toContain(`| ${data.run.cells_total} | ${data.run.statuses.success ?? 0} | ${data.run.cost_usd_total} | ${data.run.wall_clock_total_h} |`);
    expect(markdown).toContain("### The complete prompt set");
    for (const prompt of data.generated.prompts) expect(markdown).toContain(`| ${prompt.tier} | ${prompt.id} |`);
    expect(markdown).toContain("### Every lane");
    expect(markdown).toContain("### Every lane by tier");

    const models = data.generated.models.filter((model) => data.lanes.some((lane) => lane.model === model));
    const lane = (version: string, model: string) => data.lanes.find((entry) => entry.version === version && entry.model === model);
    const groupedRows = (pick: (entry: typeof data.lanes[number]) => number | null) => data.generated.versions.map((version) =>
      [version, ...models.map((model) => { const entry = lane(version, model); return entry ? pick(entry) : null; })]);
    const group = (version: string, name: string) => data.tier_groups.find((entry) => entry.version === version && entry.scope === "bisect models" && entry.group === name);
    for (const version of data.generated.versions) {
      expectChartRow(markdown, "Task pass@k on T1–T4 and on T5, by version", [version, group(version, "T1-T4")?.at_k ?? null, group(version, "T5")?.at_k ?? null]);
      expectChartRow(markdown, "Mean output tokens generated per cell, by version", [version, data.versions.find((entry) => entry.version === version)?.output_tokens_mean ?? null]);
      expectChartRow(markdown, "Enforcement-layer state files written per cell, by version", [version, data.versions.find((entry) => entry.version === version)?.hook_files_mean ?? null]);
    }
    for (const row of groupedRows((entry) => entry.format_pct)) expectChartRow(markdown, "Output-format compliance, by version and model", row);
    for (const row of groupedRows((entry) => entry.algorithm_entry_pct)) expectChartRow(markdown, "Did the version enter the Algorithm before heavy work?", row);
    for (const row of groupedRows((entry) => entry.algorithm_skip_pct)) expectChartRow(markdown, "Did it correctly STAY OUT of the Algorithm on trivial work?", row);
    for (const row of data.raw_vs_l7) expectChartRow(markdown, "L7 minus the bare control, task pass@k", [row.model, row.delta_at_k]);
    for (const [score, count] of Object.entries(data.judge.score_histogram)) expectChartRow(markdown, "Judge score distribution", [score, count]);

    expect(await readFile("docs/report.md", "utf8")).toBe(markdown);
    expect(markdown).not.toContain("<svg");
    expect((markdown.match(/^\*\*Chart data\*\*$/gm) ?? []).length).toBe(Object.keys(CHART_CAPTIONS).length);
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
