// Copies the in-browser OCR engine into public/ocr so the review page can
// load it from this site (no third-party CDN; works behind a firewall).
// Runs before `dev` and `build`; the output is not committed.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const out = path.resolve('public/ocr');

const assets = [
  [path.join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  // LSTM engine builds; the worker picks the one the browser supports.
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map((core) => [
    path.join(pkgDir('tesseract.js-core'), `${core}.wasm.js`),
    `${core}.wasm.js`,
  ]),
  // The compact "best_int" English model (2.8 MB).
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];

await mkdir(out, { recursive: true });
await Promise.all(assets.map(([from, to]) => copyFile(from, path.join(out, to))));
console.log(`copied ${assets.length} OCR assets to public/ocr`);
