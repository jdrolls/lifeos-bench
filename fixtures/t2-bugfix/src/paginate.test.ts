import { expect, test } from "bun:test";
import { paginate } from "./paginate";

test("includes every item on the last page", () => {
  expect(paginate(["a", "b", "c", "d", "e"], 3, 2)).toEqual(["e"]);
});

test("returns a full page when enough items remain", () => {
  expect(paginate([1, 2, 3, 4], 2, 2)).toEqual([3, 4]);
});
