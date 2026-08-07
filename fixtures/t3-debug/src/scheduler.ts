import type { Queue } from "./queue";
import type { Worker } from "./worker";

export function schedule<T>(queue: Queue<T>, worker: Worker<T>): T[] {
  const completed: T[] = [];

  // The worker removes the current item. Iterating this live array skips items.
  for (const _item of queue.items) {
    const job = worker.consume(queue);
    if (job !== undefined) completed.push(job);
  }

  return completed;
}
