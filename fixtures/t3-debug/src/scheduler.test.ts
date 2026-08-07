import { expect, test } from "bun:test";
import { Queue } from "./queue";
import { schedule } from "./scheduler";
import { Worker } from "./worker";

test("schedules every queued job in order", () => {
  const queue = new Queue(["first", "second", "third", "fourth"]);

  expect(schedule(queue, new Worker())).toEqual([
    "first",
    "second",
    "third",
    "fourth",
  ]);
  expect(queue.size).toBe(0);
});
