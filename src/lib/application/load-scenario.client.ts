/**
 * Client-side helper that loads a demo scenario PDF into upload state.
 *
 * Replaces the prior `application.json + label.jpg` flow with a single
 * `application.pdf` fetch — the new contract for /api/verify. Validation
 * happens server-side inside the verify pipeline; here we just shape the
 * blob into a File the reducer can stage.
 */

export interface ScenarioOption {
  slug: string;
  label: string;
  description: string;
}

export const DEMO_SCENARIOS: readonly ScenarioOption[] = [
  {
    slug: '01-ridge-creek-bourbon',
    label: '1 — Ridge Creek Bourbon',
    description: 'Clean compliant — all fields match.',
  },
  {
    slug: '02-silver-birch-vodka',
    label: '2 — Silver Birch Vodka',
    description: 'Brand drift — label says "Silver Birch Premium".',
  },
  {
    slug: '03-hawthorne-cabernet',
    label: '3 — Hawthorne Cabernet',
    description: 'Wrong wine — label shows Merlot / Sonoma County.',
  },
  {
    slug: '04-ironwood-ipa',
    label: '4 — Ironwood IPA',
    description: 'Missing Government Warning text on the label.',
  },
  {
    slug: '05-calypso-rum',
    label: '5 — Calypso Rum',
    description: 'Producer mismatch + ABV shown as "80 PROOF" only.',
  },
];

export async function loadScenarioPdf(slug: string): Promise<File> {
  const url = `/samples/applications/${slug}/application.pdf`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `Failed to load scenario PDF ${slug} (${res.status} ${res.statusText}).`,
    );
  }
  const blob = await res.blob();
  return new File([blob], `${slug}.pdf`, { type: 'application/pdf' });
}
