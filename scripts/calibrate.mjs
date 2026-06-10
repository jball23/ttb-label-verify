// Draw actual size-10 X glyphs at candidate (x,y) coords for each checkbox,
// each in a unique color, with a tiny label. Open the result and pick the
// color whose X is best-centered in each box.

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const bytes = await readFile('scripts/.cola-template-flat.pdf');
const pdf = await PDFDocument.load(bytes);
const form = pdf.getForm();
form.flatten();
const page = pdf.getPage(0);
const helv = await pdf.embedFont(StandardFonts.Helvetica);
const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

// Candidate positions per box. Each box gets 4 candidates so we can compare.
const candidates = {
  Domestic: [
    { x: 143, y: 873, color: rgb(1, 0, 0), tag: 'A' },     // red
    { x: 146, y: 875, color: rgb(0, 0.6, 0), tag: 'B' },   // green
    { x: 148, y: 876, color: rgb(0, 0, 1), tag: 'C' },     // blue
    { x: 150, y: 878, color: rgb(1, 0, 1), tag: 'D' },     // magenta
  ],
  WINE: [
    { x: 145, y: 830, color: rgb(1, 0, 0), tag: 'A' },
    { x: 147, y: 832, color: rgb(0, 0.6, 0), tag: 'B' },
    { x: 149, y: 833, color: rgb(0, 0, 1), tag: 'C' },
    { x: 151, y: 834, color: rgb(1, 0, 1), tag: 'D' },
  ],
  DS: [
    { x: 145, y: 818, color: rgb(1, 0, 0), tag: 'A' },
    { x: 147, y: 820, color: rgb(0, 0.6, 0), tag: 'B' },
    { x: 149, y: 822, color: rgb(0, 0, 1), tag: 'C' },
    { x: 151, y: 824, color: rgb(1, 0, 1), tag: 'D' },
  ],
  MB: [
    { x: 145, y: 806, color: rgb(1, 0, 0), tag: 'A' },
    { x: 147, y: 808, color: rgb(0, 0.6, 0), tag: 'B' },
    { x: 149, y: 810, color: rgb(0, 0, 1), tag: 'C' },
    { x: 151, y: 812, color: rgb(1, 0, 1), tag: 'D' },
  ],
};

for (const [box, opts] of Object.entries(candidates)) {
  for (const o of opts) {
    page.drawText('X', { x: o.x, y: o.y, size: 10, font: helvBold, color: o.color });
    // tiny tag to the right so we can identify each one in close quarters
    page.drawText(o.tag, {
      x: o.x + 8,
      y: o.y,
      size: 4,
      font: helv,
      color: o.color,
    });
  }
}

await writeFile('/tmp/calibrate.pdf', await pdf.save());
console.log('wrote /tmp/calibrate.pdf');
console.log('A=red, B=green, C=blue, D=magenta');
