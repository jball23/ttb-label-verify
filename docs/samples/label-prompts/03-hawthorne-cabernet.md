# Label image-gen prompt — Scenario 03: Hawthorne Cabernet (varietal + appellation mismatch)

**Target file:** `public/samples/applications/03-hawthorne-cabernet/label.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat unrolled front label, ~1024×1024 (wine labels are often near-square), photorealistic, neutral light-gray studio background.

**Intentional mismatch:** The application's Item 10 grape varietal is **"Cabernet Sauvignon"** and Item 11 appellation is **"Napa Valley"** — but on this label the wine is declared as **"Merlot"** from **"Sonoma County"**. Brand and producer still match the application. The verify pipeline should flag two cross-check failures (varietal AND appellation).

---

## Prompt

> Create a photorealistic, flat, unrolled front label for a 750 mL bottle of red wine. Classic California winery aesthetic: warm ivory cotton-paper background, deep burgundy and bronze accents, an elegant engraved illustration of an old stone winery with hawthorn trees in the upper third, ornate hand-drawn border. Render as a flat label on a neutral light-gray studio surface, evenly lit, slight paper texture. Do NOT show a 3D bottle.
>
> The label must contain the following text exactly:
>
> - Top center, large engraved-style serif: **HAWTHORNE VINEYARDS**
> - Below, small italic serif: *Estate Grown · Family Owned Since 1978*
> - Middle: engraved winery + hawthorn-trees illustration
> - Just below the illustration, large bold serif (this is the varietal designation): **MERLOT**
> - Below the varietal, smaller serif italics (this is the appellation): *Sonoma County*
> - Below appellation, small serif: **2023**
> - Lower center, small serif: **Produced and bottled by Hawthorne Cellars, Inc. · Healdsburg, California**
> - Lower left, small sans-serif: **13.5% ALC/VOL**
> - Lower right, small sans-serif: **750 mL**
> - Bottom strip, narrow sans-serif at minimum legible size, exactly this text in a single block:
>
>   `GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`
>
> Render every character of the government warning verbatim. Output the label only, no bottle, no glass, no background props.

## Verification checklist after generation

- [ ] Brand reads exactly **HAWTHORNE VINEYARDS**
- [ ] **Varietal line reads exactly "MERLOT"** (intentional mismatch — application says Cabernet Sauvignon)
- [ ] **Appellation reads exactly "Sonoma County"** (intentional mismatch — application says Napa Valley)
- [ ] Producer line includes "Hawthorne Cellars, Inc." and "Healdsburg, California"
- [ ] ABV reads "13.5% ALC/VOL"
- [ ] Net contents reads "750 mL"
- [ ] Government warning complete and verbatim
- [ ] Flat label, not a 3D bottle

Both varietal and appellation should be wrong on the label — that's the test. Don't auto-correct them in regeneration.
