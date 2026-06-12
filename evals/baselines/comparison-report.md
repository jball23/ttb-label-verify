# Tesseract baseline parity report

Captured: 2026-06-12T03:19:02.513Z
Baseline source: 2026-06-11-gpt4o-cola.json (mean total 17056ms)

## Verdict: FAIL

- Mean accuracy: **71.1%** vs baseline (tolerance ±5%)
- Mean total latency: **49744ms** (baseline 17056ms — ❌)
- VLM fallback density: 84/180 fields (47%)
- Cost: ~$0.084 per batch (rough; per-fallback ~$0.001 at gpt-4o pricing)

## Per-sample summary

| Filename | Baseline latency | New latency | Δ | Accuracy | Fallbacks |
|----------|-------------------|-------------|----|----------|-----------|
| 26062001000676-soplica-apricot.pdf | 14432ms | 38772ms | +24340ms | 89% | 3/9 |
| 26069001000391-super-cattivo-mandarino.pdf | 10444ms | 29750ms | +19306ms | 78% | 3/9 |
| 26069001000588-country-and-western-ale.pdf | 11041ms | 39049ms | +28008ms | 44% | 4/9 |
| 26075001000643-layback-coconut-blanco.pdf | 12183ms | 50591ms | +38408ms | 56% | 5/9 |
| 26075001000980-vina-la-rosa.pdf | 13404ms | 43718ms | +30314ms | 67% | 2/9 |
| 26082001000594-gary-farrell.pdf | 10926ms | 39017ms | +28091ms | 67% | 5/9 |
| 26083001000522-chacewater.pdf | 12531ms | 72385ms | +59854ms | 78% | 7/9 |
| 26084001000449-ironwood-cellars.pdf | 17054ms | 44852ms | +27798ms | 89% | 3/9 |
| 26084001000703-j-palacios-remondo.pdf | 9103ms | 38586ms | +29483ms | 67% | 2/9 |
| 26084001000715-cointreau-spicy-margarita.pdf | 29546ms | 46899ms | +17353ms | 56% | 6/9 |
| 26084001000723-cointreau-mango-margarita.pdf | 17554ms | 47062ms | +29508ms | 56% | 6/9 |
| 26086001000146-kim-hibiscus-sour.pdf | 18787ms | 42976ms | +24189ms | 56% | 5/9 |
| 26086001000600-chateau-montet.pdf | 21299ms | 43981ms | +22682ms | 89% | 2/9 |
| 26086001000651-bouchard-aine-fils.pdf | 21091ms | 71190ms | +50099ms | 78% | 3/9 |
| 26089001000452-eagle-ridge-blanc.pdf | 10618ms | 54706ms | +44088ms | 78% | 4/9 |
| 26089001000771-el-mayoral-de-la-hacienda.pdf | 31150ms | 71346ms | +40196ms | 67% | 5/9 |
| 26090001000206-castello-di-radda.pdf | 19460ms | 72590ms | +53130ms | 89% | 7/9 |
| 26091001000783-chateau-sainte-genevieve.pdf | 19970ms | 43535ms | +23565ms | 89% | 3/9 |
| 26092001000442-visuals-illuminate-the-sky.pdf | 10132ms | 39823ms | +29691ms | 67% | 4/9 |
| 26092001000545-quibole-tequila.pdf | 30393ms | 64048ms | +33655ms | 67% | 5/9 |

## Per-field accuracy aggregate

| Field | Match rate |
|-------|------------|
| label.brandName | 2/20 (10%) |
| label.abv | 13/20 (65%) |
| label.netContents | 19/20 (95%) |
| label.producer | 16/20 (80%) |
| label.countryOfOrigin | 8/20 (40%) |
| label.governmentWarning | 20/20 (100%) |
| application.brandName | 20/20 (100%) |
| application.fancifulName | 18/20 (90%) |
| application.productType | 12/20 (60%) |