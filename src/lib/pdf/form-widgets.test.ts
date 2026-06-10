import { describe, expect, it } from 'vitest';
import { FORM_WIDGET_RECTS, snapApplicationProvenance } from './form-widgets';

describe('FORM_WIDGET_RECTS', () => {
  it('produces normalized 0..1 bboxes for every entry', () => {
    for (const [path, bbox] of Object.entries(FORM_WIDGET_RECTS)) {
      expect(bbox, path).toBeDefined();
      expect(bbox!.x, `${path} x`).toBeGreaterThanOrEqual(0);
      expect(bbox!.x, `${path} x`).toBeLessThanOrEqual(1);
      expect(bbox!.y, `${path} y`).toBeGreaterThanOrEqual(0);
      expect(bbox!.y, `${path} y`).toBeLessThanOrEqual(1);
      expect(bbox!.w, `${path} w`).toBeGreaterThan(0);
      expect(bbox!.w, `${path} w`).toBeLessThanOrEqual(1);
      expect(bbox!.h, `${path} h`).toBeGreaterThan(0);
      expect(bbox!.h, `${path} h`).toBeLessThanOrEqual(1);
    }
  });

  it('brand name and fanciful name are vertically adjacent + distinct', () => {
    const brand = FORM_WIDGET_RECTS['application.brandName']!;
    const fanciful = FORM_WIDGET_RECTS['application.fancifulName']!;
    // Item 6 sits above Item 7 in the PDF (PDF y increases upward), which
    // means the brand name's normalized y is SMALLER than fanciful's (because
    // we flip during conversion).
    expect(brand.y).toBeLessThan(fanciful.y);
    expect(brand.x).toBeCloseTo(fanciful.x, 2);
  });

  it('brand name is in the left-third top region of the page', () => {
    const brand = FORM_WIDGET_RECTS['application.brandName']!;
    expect(brand.x).toBeLessThan(0.5);
    expect(brand.y).toBeLessThan(0.5);
  });
});

describe('snapApplicationProvenance', () => {
  const labelBbox = { x: 0.4, y: 0.85, w: 0.18, h: 0.05 };

  it('overrides application.* bboxes with widget rects', () => {
    const input: Parameters<typeof snapApplicationProvenance>[0] = {
      'application.brandName': {
        page: 0,
        bbox: { x: 0.99, y: 0.99, w: 0.01, h: 0.01 }, // model bogus
        confidence: 'low' as const,
      },
      'label.brandName': {
        page: 0,
        bbox: labelBbox,
        confidence: 'medium' as const,
      },
    };
    const result = snapApplicationProvenance(input);
    const brand = result['application.brandName']!;
    expect(brand.bbox.x).not.toBe(0.99);
    expect(brand.confidence).toBe('high'); // promoted by snap
    // Label-side untouched.
    expect(result['label.brandName']!.bbox).toEqual(labelBbox);
  });

  it('leaves entries the model did not populate absent', () => {
    const result = snapApplicationProvenance({} as Parameters<
      typeof snapApplicationProvenance
    >[0]);
    expect(result['application.brandName']).toBeUndefined();
  });
});
