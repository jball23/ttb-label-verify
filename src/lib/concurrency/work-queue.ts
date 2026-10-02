export interface WorkQueue<T> {
  /** Adds items; they start as soon as a worker slot is free. */
  push(...items: T[]): void;
  readonly active: number;
  readonly pending: number;
}

/**
 * Runs `worker` on pushed items with at most `limit` in flight. Items can be
 * added while others run — a reviewer can drop more labels mid-batch. A
 * worker should report its own failures; a rejection is swallowed so one bad
 * item never stalls the queue.
 */
export function createWorkQueue<T>(
  limit: number,
  worker: (item: T) => Promise<void>,
  onChange?: () => void,
): WorkQueue<T> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError('limit must be a positive integer');
  const pending: T[] = [];
  let active = 0;

  const pump = (): void => {
    while (active < limit && pending.length > 0) {
      const item = pending.shift() as T;
      active += 1;
      void worker(item)
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          pump();
          onChange?.();
        });
    }
  };

  return {
    push(...items) {
      pending.push(...items);
      pump();
      onChange?.();
    },
    get active() {
      return active;
    },
    get pending() {
      return pending.length;
    },
  };
}
