export class Queue<T> {
  #items: T[];

  constructor(items: T[]) {
    this.#items = [...items];
  }

  get items(): readonly T[] {
    return this.#items;
  }

  take(): T | undefined {
    return this.#items.shift();
  }

  get size(): number {
    return this.#items.length;
  }
}
