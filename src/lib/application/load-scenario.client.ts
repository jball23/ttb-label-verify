/**
 * Client-side helper to load a demo scenario into the upload state.
 *
 * Fetches the scenario's application.json + label.jpg from `/samples/...`,
 * validates the application against the Application Zod schema, and returns a
 * `{ application, labelFile }` pair the upload reducer can stage.
 *
 * Kept separate from `loader.ts` (which is isomorphic — pure Zod) so the
 * client-only fetch logic doesn't leak into server bundles.
 */

import { parseApplication } from './loader';
import type { Application } from './types';

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

export interface LoadedScenario {
  application: Application;
  labelFile: File;
}

export async function loadScenarioFromServer(
  slug: string,
): Promise<LoadedScenario> {
  const base = `/samples/applications/${slug}`;
  const [appRes, labelRes] = await Promise.all([
    fetch(`${base}/application.json`, { cache: 'no-store' }),
    fetch(`${base}/label.jpg`, { cache: 'no-store' }),
  ]);
  if (!appRes.ok) {
    throw new Error(
      `Failed to load application.json for scenario ${slug} (${appRes.status}).`,
    );
  }
  if (!labelRes.ok) {
    throw new Error(
      `Failed to load label.jpg for scenario ${slug} (${labelRes.status}).`,
    );
  }
  const applicationRaw: unknown = await appRes.json();
  const application = parseApplication(applicationRaw);
  const blob = await labelRes.blob();
  const labelFile = new File([blob], `${slug}.jpg`, { type: 'image/jpeg' });
  return { application, labelFile };
}
