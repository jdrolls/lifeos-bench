import { expect, test } from "bun:test";
import { isEligible } from "./compare";

test("an 18-year-old is eligible", () => {
  expect(isEligible(18)).toBe(true);
});
