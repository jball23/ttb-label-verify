# Tesseract baseline parity report

Captured: 2026-06-12T04:29:07.666Z
Baseline source: 2026-06-11-gpt4o-cola.json (mean total 17056ms)

## Verdict: FAIL

- Mean accuracy: **88.9%** vs baseline (tolerance ±5%)
- Mean total latency: **11872ms** (baseline 17056ms — ✅)
- VLM fallback density: 6/18 fields (33%)
- Cost: ~$0.006 per batch (rough; per-fallback ~$0.001 at gpt-4o pricing)

## Per-sample summary

| Filename | Baseline latency | New latency | Δ | Accuracy | Fallbacks |
|----------|-------------------|-------------|----|----------|-----------|
| 26062001000676-soplica-apricot.pdf | 14432ms | 44635ms | +30203ms | 89% | 3/9 |
| 26069001000391-super-cattivo-mandarino.pdf | 10444ms | 28122ms | +17678ms | 89% | 3/9 |
| 26069001000588-country-and-western-ale.pdf | 11041ms | 43153ms | +32112ms | 0% | 0/0 |
| 26075001000643-layback-coconut-blanco.pdf | 12183ms | 7963ms | -4220ms | 0% | 0/0 |
| 26075001000980-vina-la-rosa.pdf | 13404ms | 7899ms | -5505ms | 0% | 0/0 |
| 26082001000594-gary-farrell.pdf | 10926ms | 6901ms | -4025ms | 0% | 0/0 |
| 26083001000522-chacewater.pdf | 12531ms | 7304ms | -5227ms | 0% | 0/0 |
| 26084001000449-ironwood-cellars.pdf | 17054ms | 6547ms | -10507ms | 0% | 0/0 |
| 26084001000703-j-palacios-remondo.pdf | 9103ms | 7724ms | -1379ms | 0% | 0/0 |
| 26084001000715-cointreau-spicy-margarita.pdf | 29546ms | 6223ms | -23323ms | 0% | 0/0 |
| 26084001000723-cointreau-mango-margarita.pdf | 17554ms | 6302ms | -11252ms | 0% | 0/0 |
| 26086001000146-kim-hibiscus-sour.pdf | 18787ms | 6662ms | -12125ms | 0% | 0/0 |
| 26086001000600-chateau-montet.pdf | 21299ms | 7902ms | -13397ms | 0% | 0/0 |
| 26086001000651-bouchard-aine-fils.pdf | 21091ms | 7644ms | -13447ms | 0% | 0/0 |
| 26089001000452-eagle-ridge-blanc.pdf | 10618ms | 7251ms | -3367ms | 0% | 0/0 |
| 26089001000771-el-mayoral-de-la-hacienda.pdf | 31150ms | 7297ms | -23853ms | 0% | 0/0 |
| 26090001000206-castello-di-radda.pdf | 19460ms | 6178ms | -13282ms | 0% | 0/0 |
| 26091001000783-chateau-sainte-genevieve.pdf | 19970ms | 7127ms | -12843ms | 0% | 0/0 |
| 26092001000442-visuals-illuminate-the-sky.pdf | 10132ms | 7821ms | -2311ms | 0% | 0/0 |
| 26092001000545-quibole-tequila.pdf | 30393ms | 6781ms | -23612ms | 0% | 0/0 |

## Per-field accuracy aggregate

| Field | Match rate |
|-------|------------|
| label.brandName | 2/2 (100%) |
| label.abv | 1/2 (50%) |
| label.netContents | 2/2 (100%) |
| label.producer | 2/2 (100%) |
| label.countryOfOrigin | 2/2 (100%) |
| label.governmentWarning | 2/2 (100%) |
| application.brandName | 2/2 (100%) |
| application.fancifulName | 2/2 (100%) |
| application.productType | 1/2 (50%) |