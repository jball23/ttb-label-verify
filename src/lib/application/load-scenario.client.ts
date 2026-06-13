/**
 * Client-side helper that loads a demo scenario PDF into upload state.
 *
 * The demo scenarios are real TTB COLA Online exports living under
 * `public/samples/cola/`. Each filename is the TTB ID followed by a
 * kebab-case product slug, e.g. `26086001000600-chateau-montet.pdf`.
 * We surface them in the picker by titlecasing the product portion.
 */

export interface ScenarioOption {
  slug: string;
  label: string;
}

// Source of truth: the filenames under `public/samples/cola/` (without the
// `.pdf` extension). Keep this list in sync with the directory — there's no
// runtime listing because the PDFs are served from /public as static assets.
// The first four are intentionally the fastest samples from the Tesseract
// baseline so a first-time demo click gets to a decision quickly. The rest
// stay in the original directory order.
const COLA_SLUGS: readonly string[] = [
  '26090001000206-castello-di-radda',
  '26084001000715-cointreau-spicy-margarita',
  '26084001000723-cointreau-mango-margarita',
  '26084001000449-ironwood-cellars',
  '26062001000676-soplica-apricot',
  '26069001000391-super-cattivo-mandarino',
  '26069001000588-country-and-western-ale',
  '26075001000643-layback-coconut-blanco',
  '26075001000980-vina-la-rosa',
  '26082001000594-gary-farrell',
  '26083001000522-chacewater',
  '26084001000703-j-palacios-remondo',
  '26086001000146-kim-hibiscus-sour',
  '26086001000600-chateau-montet',
  '26086001000651-bouchard-aine-fils',
  '26089001000452-eagle-ridge-blanc',
  '26089001000771-el-mayoral-de-la-hacienda',
  '26090001000206-castello-di-radda',
  '26091001000783-chateau-sainte-genevieve',
  '26092001000442-visuals-illuminate-the-sky',
  '26092001000545-quibole-tequila',
];

function humanizeSlug(slug: string): string {
  // Slugs are `<ttbId>-<kebab-product-name>`. Drop the leading 14-digit
  // TTB ID and titlecase the rest; preserve hyphenated multi-word names.
  const product = slug.replace(/^\d+-/, '');
  return product
    .split('-')
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

export const DEMO_SCENARIOS: readonly ScenarioOption[] = COLA_SLUGS.map(
  (slug) => ({
    slug,
    label: humanizeSlug(slug),
  }),
);

export async function loadScenarioPdf(slug: string): Promise<File> {
  const url = `/samples/cola/${slug}.pdf`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `Failed to load scenario PDF ${slug} (${res.status} ${res.statusText}).`,
    );
  }
  const blob = await res.blob();
  return new File([blob], `${slug}.pdf`, { type: 'application/pdf' });
}
