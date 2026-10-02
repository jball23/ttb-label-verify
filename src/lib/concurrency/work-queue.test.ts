import { describe, expect, it } from 'vitest';
import { createWorkQueue } from './work-queue';

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

async function drained(queue: { active: number; pending: number }) {
  while (queue.active > 0 || queue.pending > 0) await tick();
}

describe('createWorkQueue', () => {
  it('never runs more than the limit at once, and uses all of it', async () => {
    let active = 0;
    let peak = 0;
    const queue = createWorkQueue<number>(6, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(n % 3);
      active -= 1;
    });
    queue.push(...Array.from({ length: 20 }, (_, i) => i));
    await drained(queue);
    expect(peak).toBe(6);
  });

  it('accepts items pushed while others are running', async () => {
    const done: number[] = [];
    const queue = createWorkQueue<number>(2, async (n) => {
      await tick(2);
      done.push(n);
    });
    queue.push(1, 2, 3);
    await tick();
    queue.push(4, 0);
    await drained(queue);
    expect(done.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps going after a worker fails', async () => {
    const done: number[] = [];
    const queue = createWorkQueue<number>(1, async (n) => {
      if (n === 1) throw new Error('bad label');
      done.push(n);
    });
    queue.push(1, 2, 3);
    await drained(queue);
    expect(done).toEqual([2, 3]);
  });

  it('reports changes so a UI can re-render', async () => {
    let changes = 0;
    const queue = createWorkQueue<number>(
      2,
      async () => {
        await tick();
      },
      () => {
        changes += 1;
      },
    );
    queue.push(1, 2);
    await drained(queue);
    expect(changes).toBe(3); // one push, two completions
  });

  it('rejects a non-positive limit', () => {
    expect(() => createWorkQueue(0, async () => undefined)).toThrow(RangeError);
  });
});
