import { describe, expect, test } from "bun:test";
import { extractLastJudgeReply, judgeWithRetry, scrubResponse } from "../tools/Judge.ts";

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
