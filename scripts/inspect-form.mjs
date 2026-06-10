import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const bytes = await readFile('scripts/.cola-template-decrypted.pdf');
const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });

const form = pdf.getForm();
const fields = form.getFields();
console.log(`Found ${fields.length} fields in the AcroForm.\n`);

for (const f of fields) {
  const type = f.constructor.name;
  const name = f.getName();
  // crude position lookup using the first widget's rect
  const widgets = f.acroField.getWidgets();
  const rect = widgets[0]?.getRectangle();
  const page = widgets[0] ? findPageIndex(pdf, widgets[0].dict) : -1;
  const rectStr = rect
    ? `p${page} [x=${rect.x.toFixed(0)}, y=${rect.y.toFixed(0)}, w=${rect.width.toFixed(0)}, h=${rect.height.toFixed(0)}]`
    : '(no widget rect)';
  console.log(`${type.padEnd(20)} ${name.padEnd(40)} ${rectStr}`);
}

function findPageIndex(doc, widgetDict) {
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots();
    if (!annots) continue;
    const arr = annots.asArray();
    for (const ref of arr) {
      if (doc.context.lookup(ref) === widgetDict) return i;
    }
  }
  return -1;
}
