import { describe, expect, test } from "bun:test";
import { extractLastJudgeReply, judgeWithRetry, personaMaterials, scrubResponse, selectByModel } from "../tools/Judge.ts";

const reply = (score: number) => JSON.stringify({ score, reasoning: "specific rationale", criteria_met: ["criterion"] });

describe("Judge blinding scrub", () => {
  test("removes framework banner lines while preserving substantive content", () => {
    const response = [
      "Useful explanation first.",
      "═══ PAI ═══",
      "♻ ALGORITHM selected",
      "NATIVE MODE / MINIMAL enabled",
      "🗣️ LIFEOS announcement",
      "Useful explanation last.",
    ].join("\n");

    expect(scrubResponse(response)).toBe("Useful explanation first.\nUseful explanation last.");
  });
});

describe("Judge JSON extraction", () => {
  test("extracts a valid reply and tolerates trailing non-JSON output", () => {
    expect(extractLastJudgeReply(`judge log\n${reply(4)}\nfinished successfully`)).toEqual({
      score: 4,
      reasoning: "specific rationale",
      criteria_met: ["criterion"],
    });
  });

  test("uses the last valid reply when output contains more than one JSON object", () => {
    expect(extractLastJudgeReply(`${reply(2)}\nmetadata: {}\n${reply(5)}`)?.score).toBe(5);
  });

  test("retries once after malformed output", async () => {
    let calls = 0;
    const result = await judgeWithRetry(async () => {
      calls++;
      return calls === 1 ? '{"score": 4, "reasoning": "truncated"' : reply(4);
    });

    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.reply?.score).toBe(4);
    expect(result.error).toBeNull();
  });
});

import { extractJudgeReply } from "../tools/Judge.ts";
import { test, expect } from "bun:test";

test("extractJudgeReply survives unbalanced braces in transcript", () => {
  const transcript = [
    "codex transcript",
    "while (queue.size > 0) {",   // unbalanced open brace
    "@@ -4,8 +4,7 @@ }",          // stray close brace
    '{"score":5,"reasoning":"ok","criteria_met":["a"]}',
    "tokens used",
    "634",
  ].join("\n");
  expect(extractJudgeReply(transcript)?.score).toBe(5);
});

test("extractJudgeReply falls back to depth scan for wrapped JSON", () => {
  const transcript = 'noise {"score":3,\n"reasoning":"multi-line",\n"criteria_met":[]} trailing';
  expect(extractJudgeReply(transcript)?.score).toBe(3);
});

/**
 * Cross-vendor blinding requires one judging pass per vendor, since JUDGE_CMD is a single
 * template. Without a model filter, half the matrix would be graded by its own vendor.
 */
test("selectByModel narrows a judging pass to one vendor's cells", () => {
  const judgments = [
    { source: { model: "sonnet-5" } },
    { source: { model: "gpt-5.6-terra" } },
    { source: { model: "sonnet-5" } },
  ];

  expect(selectByModel(judgments, "sonnet-5")).toHaveLength(2);
  expect(selectByModel(judgments, "gpt-5.6-terra")).toHaveLength(1);
  expect(selectByModel(judgments, undefined)).toHaveLength(3);
  expect(selectByModel(judgments, "sonnet-5,gpt-5.6-terra")).toHaveLength(3);
});

test("selectByModel rejects an empty model list rather than silently judging nothing", () => {
  expect(() => selectByModel([{ source: { model: "sonnet-5" } }], " ")).toThrow("at least one model id");
});

/**
 * Regression: `grounding_quality` asks whether a response cites the user's ACTUAL profile, but
 * the judge prompt never contained the profile. The judge could only guess, and two cells citing
 * the identical real fact received opposite verdicts. T5 is unmeasurable without this.
 */
test("persona materials load and carry the synthetic profile's distinctive facts", async () => {
  const persona = await personaMaterials();

  expect(persona.length).toBeGreaterThan(1000);
  // Distinctive persona anchors the T5 rubrics grade against.
  expect(persona).toMatch(/Batcomputer|Wayne|Alfred|Gotham/i);
  // And never the operator's real identity.
  expect(persona).not.toMatch(/Ralph Trades|Polytrader/i);
});
