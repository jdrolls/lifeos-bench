import type { Queue } from "./queue";

export class Worker<T> {
  consume(queue: Queue<T>): T | undefined {
    return queue.take();
  }
}
