export type PoolOutcome<R> = { ok: true; value: R } | { ok: false; error: unknown };

export interface RunPoolOptions<T, R> {
  /** Maximum number of workers running at once. */
  limit: number;
  /** Stops handing out new items; items already running finish. */
  signal?: AbortSignal;
  onStart?: (item: T, index: number) => void;
  onSettled?: (item: T, outcome: PoolOutcome<R>, index: number) => void;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight. One failure
 * never stops the others; every item's outcome is reported and returned in
 * input order (items skipped after an abort are left undefined).
 */
export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  { limit, signal, onStart, onSettled }: RunPoolOptions<T, R>,
): Promise<Array<PoolOutcome<R> | undefined>> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  const outcomes: Array<PoolOutcome<R> | undefined> = new Array(items.length);
  let next = 0;

  const lane = async (): Promise<void> => {
    while (next < items.length && !signal?.aborted) {
      const index = next++;
      const item = items[index]!;
      onStart?.(item, index);
      let outcome: PoolOutcome<R>;
      try {
        outcome = { ok: true, value: await worker(item, index) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      outcomes[index] = outcome;
      onSettled?.(item, outcome, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return outcomes;
}
