import { describe, expect, it } from 'vitest';
import { runPool } from './run-pool';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runPool', () => {
  it('never runs more than the limit at once, and uses all of it', async () => {
    let active = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 20 }, (_, i) => i),
      async (i) => {
        active += 1;
        peak = Math.max(peak, active);
        await tick(i % 3);
        active -= 1;
      },
      { limit: 6 },
    );
    expect(peak).toBe(6);
  });

  it('returns every outcome in input order, isolating failures', async () => {
    const outcomes = await runPool(
      [1, 2, 3, 0],
      async (n) => {
        await tick(4 - n);
        if (n === 2) throw new Error('bad label');
        return n * 10;
      },
      { limit: 2 },
    );
    expect(outcomes).toEqual([
      { ok: true, value: 10 },
      { ok: false, error: new Error('bad label') },
      { ok: true, value: 30 },
      // 0 is falsy; the old helper stopped at the first falsy item.
      { ok: true, value: 0 },
    ]);
  });

  it('reports each item as it starts and settles', async () => {
    const events: string[] = [];
    await runPool(['a', 'b'], async (s) => s.toUpperCase(), {
      limit: 1,
      onStart: (s) => events.push(`start ${s}`),
      onSettled: (s, outcome) => events.push(`done ${s} ${outcome.ok}`),
    });
    expect(events).toEqual(['start a', 'done a true', 'start b', 'done b true']);
  });

  it('stops starting new items once aborted', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const outcomes = await runPool(
      [1, 2, 3, 4, 5],
      async (n) => {
        started.push(n);
        if (n === 2) controller.abort();
        await tick(1);
        return n;
      },
      { limit: 2, signal: controller.signal },
    );
    expect(started).toEqual([1, 2]);
    expect(outcomes.filter(Boolean)).toHaveLength(2);
  });

  it('rejects a non-positive limit', async () => {
    await expect(runPool([1], async (n) => n, { limit: 0 })).rejects.toThrow(RangeError);
  });
});
