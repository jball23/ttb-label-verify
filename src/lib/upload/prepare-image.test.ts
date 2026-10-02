import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_EDGE_PX } from './prepare-image';

describe('fitWithin', () => {
  it('scales the long edge down to the limit, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE_PX, height: 1200 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 533, height: MAX_EDGE_PX });
  });

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
