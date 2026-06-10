// Set every generic-named field to its OWN name as a marker, then render so
// we can see what each field actually is. Run with: node scripts/probe-form.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const bytes = await readFile('scripts/.cola-template-flat.pdf');
const pdf = await PDFDocument.load(bytes);
const form = pdf.getForm();

for (const field of form.getFields()) {
  const name = field.getName();
  const type = field.constructor.name;
  try {
    if (type === 'PDFTextField') {
      const tf = form.getTextField(name);
      tf.setMaxLength(undefined);
      // Short label so it fits in tiny fields
      const shortLabel = name.replace(/^(Text|YEAR |SERIAL NUMBER |\d+[.a-z]*\s*)/, '').slice(0, 8);
      tf.setText(shortLabel || name.slice(0, 8));
    } else if (type === 'PDFCheckBox') {
      form.getCheckBox(name).check();
    }
  } catch {
    /* ignore */
  }
}

form.flatten();
await writeFile('/tmp/ttb-probe.pdf', await pdf.save());
console.log('wrote /tmp/ttb-probe.pdf');
