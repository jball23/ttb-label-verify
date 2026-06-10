/**
 * Builds 5 filled-out TTB F 5100.31 COLA applications with labels attached.
 *
 * For each `public/samples/applications/0N-*` folder:
 *   1. Loads the decrypted blank form (scripts/.cola-template-flat.pdf).
 *   2. Fills the AcroForm fields from `application.json`.
 *   3. Item 3 (Source) and Item 5 (Type) are handled this way:
 *        - "Domestic" has a real widget → form.getCheckBox('Check Box34')
 *        - "WINE"    has a real widget → form.getCheckBox('Check Box22')
 *        - All other options (Imported, DS, MB) have no widget on the form,
 *          only printed checkbox glyphs. We draw X overlays AFTER flatten so
 *          the marks land on top of the static page content.
 *   4. Embeds the corresponding label.jpg in the "AFFIX LABELS BELOW" area.
 *   5. Writes `application.pdf` in the scenario folder.
 *
 * Run with: node scripts/build-demo-pdfs.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const TEMPLATE = 'scripts/.cola-template-flat.pdf';
const APPS_DIR = 'public/samples/applications';

// X-mark overlay coordinates (PDF points, origin bottom-left, page 1, 612x1008).
// We mark ALL Item 3 / Item 5 selections with drawn X glyphs so the form has a
// consistent visual style — even though Domestic + WINE happen to have real
// widgets (Check Box34 and Check Box22), their default ✓ glyph clashes with
// the drawn X used for Imported / DS / MB.
// Each entry centers an "X" drawText (font size 12, glyph ~7w × 8h) inside the
// printed checkbox glyph on the static form artwork. Coords calibrated against
// scripts/calibrate.mjs — the printed boxes don't always align with the
// AcroForm widget rects, so trust the calibration grid, not the widget rects.
const X_SIZE = 12;
const OVERLAY_COORDS = {
  Domestic: { x: 145, y: 874 },
  Imported: { x: 202, y: 874 },
  WINE: { x: 147, y: 830 },
  'DISTILLED SPIRITS': { x: 147, y: 817 },
  'MALT BEVERAGES': { x: 147, y: 806 },
};

const LABEL_AREA = { x: 25, y: 29, w: 565, h: 298 };

function setText(form, fieldName, value) {
  if (value == null || value === '') return;
  try {
    const f = form.getTextField(fieldName);
    // Some fields cap maxLength tightly (e.g. Fanciful Name at 30 chars).
    // Our scenarios occasionally exceed that — clear the limit.
    f.setMaxLength(undefined);
    f.setText(String(value));
  } catch (err) {
    console.warn(`  ! could not set "${fieldName}": ${err.message}`);
  }
}

function checkBox(form, fieldName) {
  try {
    form.getCheckBox(fieldName).check();
  } catch (err) {
    console.warn(`  ! could not check "${fieldName}": ${err.message}`);
  }
}

function splitSerial(serial) {
  const [year, rest] = serial.split('-');
  return {
    year: year.padStart(2, '0').slice(0, 2).split(''),
    serial: rest.padStart(4, '0').slice(0, 4).split(''),
  };
}

function formatApplicantBlock(applicant) {
  if (!applicant) return '';
  return [
    applicant.name,
    applicant.addressLine1,
    `${applicant.city}, ${applicant.state} ${applicant.postalCode}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

async function embedLabelImage(pdf, page, labelBytes) {
  const jpg = await pdf.embedJpg(labelBytes);
  const ratio = Math.min(LABEL_AREA.w / jpg.width, LABEL_AREA.h / jpg.height);
  const drawW = jpg.width * ratio;
  const drawH = jpg.height * ratio;
  const drawX = LABEL_AREA.x + (LABEL_AREA.w - drawW) / 2;
  const drawY = LABEL_AREA.y + (LABEL_AREA.h - drawH) / 2;
  page.drawImage(jpg, { x: drawX, y: drawY, width: drawW, height: drawH });
}

async function buildOne(scenarioDir) {
  const appJson = JSON.parse(
    await readFile(path.join(scenarioDir, 'application.json'), 'utf8'),
  );
  const labelBytes = await readFile(path.join(scenarioDir, 'label.jpg'));
  const templateBytes = await readFile(TEMPLATE);

  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const page = pdf.getPage(0);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const times = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const f = appJson.form;
  const { year, serial } = splitSerial(f.serialNumber);

  // ---- AcroForm text fields ----
  setText(
    form,
    "2.  PLANT REGISTRY/BASIC PERMIT/BREWER'S NO. (Required)",
    f.plantRegistryNumber,
  );
  setText(form, 'YEAR 1', year[0]);
  setText(form, 'YEAR 2', year[1]);
  setText(form, 'SERIAL NUMBER 1', serial[0]);
  setText(form, 'SERIAL NUMBER 2', serial[1]);
  setText(form, 'SERIAL NUMBER 3', serial[2]);
  setText(form, 'SERIAL NUMBER 4', serial[3]);
  setText(form, '6. BRAND NAME (Required)', f.brandName);
  setText(form, '7. FANCIFUL NAME (If any)', f.fancifulName);
  setText(
    form,
    '8. NAME AND ADDRESS OF APPLICANT AS SHOWN ON PLANT REGISTRY, BASIC',
    formatApplicantBlock(f.applicant),
  );
  if (f.mailingAddress) {
    setText(
      form,
      '8a. MAILING ADDRESS, IF DIFFERENT',
      formatApplicantBlock(f.mailingAddress),
    );
  }
  setText(form, '9.  FORMULA', f.formulaId);
  setText(form, '10. GRAPE VARIETAL(S) Wine only', f.grapeVarietals);
  setText(form, '11.  WINE APPELLATION (If on label)', f.wineAppellation);
  setText(form, '12.  PHONE NUMBER', f.phone);
  setText(form, '13.  EMAIL ADDRESS', f.email);
  setText(form, '16.  DATE OF APPLICATION', formatDate(f.applicationDate));
  setText(
    form,
    '18.  PRINT NAME OF APPLICANT OR AUTHORIZED AGENT',
    f.applicantSignatureName,
  );
  // Item 15 — blown/branded/embossed info. None of our scenarios use blown
  // mandatory info, so "N/A" reads as a deliberately complete submission.
  setText(
    form,
    '15.  SHOW ANY INFORMATION THAT IS BLOWN, BRANDED, OR EMBOSSED ON THE CONTAINER (e.g., net contents) ONLY IF IT DOES NOT APPEAR ON THE LABELS',
    'N/A — All mandatory information appears on the affixed label below.',
  );

  // ---- AcroForm checkboxes (Item 14 only — Items 3/5 use X overlays) ----
  if (f.applicationType === 'CERTIFICATE_OF_LABEL_APPROVAL') {
    checkBox(form, '14a. CERTIFICATE OF LABEL APPROVAL');
  }

  // ---- Flatten — collapses widgets into static content ----
  form.flatten();

  // ---- Item 3 + Item 5 X overlays (drawn ON TOP of flattened form) ----
  const sourceCoord = OVERLAY_COORDS[f.source];
  if (sourceCoord) {
    page.drawText('X', {
      x: sourceCoord.x,
      y: sourceCoord.y,
      size: X_SIZE,
      font: helvBold,
    });
  }
  const typeCoord = OVERLAY_COORDS[f.productType];
  if (typeCoord) {
    page.drawText('X', {
      x: typeCoord.x,
      y: typeCoord.y,
      size: X_SIZE,
      font: helvBold,
    });
  }

  // Item 17 — Signature. Use Times-Italic at a slightly larger size and
  // off-baseline angle to read as a real handwritten signature rather than a
  // typeset name. The flattened form's Item 17 cell sits around y=500-518.
  page.drawText(f.applicantSignatureName, {
    x: 150,
    y: 504,
    size: 14,
    font: times,
    color: rgb(0.12, 0.12, 0.45),
  });

  // Embed the label after everything else so the image button widget's
  // (flattened) empty appearance doesn't paint over it.
  await embedLabelImage(pdf, page, labelBytes);

  const outBytes = await pdf.save();
  const outPath = path.join(scenarioDir, 'application.pdf');
  await writeFile(outPath, outBytes);
  return outPath;
}

async function main() {
  const entries = await readdir(APPS_DIR, { withFileTypes: true });
  const scenarios = entries
    .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
    .map((e) => path.join(APPS_DIR, e.name))
    .sort();

  console.log(`Building ${scenarios.length} demo PDFs...\n`);
  for (const dir of scenarios) {
    console.log(`▸ ${path.basename(dir)}`);
    const out = await buildOne(dir);
    console.log(`  ✓ ${out}\n`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
