import { GOVERNMENT_WARNING_CANONICAL } from '../validation/ttb-constants';
import { type LabelImage, type LabelReader } from './label-reader';
import { type LabelReading } from './reading';

/** A fully compliant reading of the brief's sample label (OLD TOM DISTILLERY). */
export function compliantReading(overrides: Partial<LabelReading> = {}): LabelReading {
  const high = (value: string) => ({ value, confidence: 'high' as const });
  return {
    fields: {
      brandName: high('OLD TOM DISTILLERY'),
      classType: high('Kentucky Straight Bourbon Whiskey'),
      alcoholContent: high('45% Alc./Vol. (90 Proof)'),
      netContents: high('750 mL'),
      producer: high('Bottled by Old Tom Distillery, Bardstown, Kentucky'),
      countryOfOrigin: { value: null, confidence: 'high' },
    },
    governmentWarning: {
      verbatimText: GOVERNMENT_WARNING_CANONICAL,
      prefixAppearsBold: true,
    },
    imageQuality: { legible: true, issues: [] },
    ...overrides,
  };
}

/**
 * Deterministic reader for tests and offline demos — no network. Returns the
 * reading produced by `readingFor`, defaulting to a compliant label.
 */
export class FakeLabelReader implements LabelReader {
  readonly modelId = 'fake';

  constructor(
    private readonly readingFor: (image: LabelImage) => LabelReading | Promise<LabelReading> = () =>
      compliantReading(),
  ) {}

  async read(image: LabelImage): Promise<LabelReading> {
    return this.readingFor(image);
  }
}
