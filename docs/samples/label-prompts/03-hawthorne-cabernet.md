# Label image prompt — Hawthorne Vineyards (compliant; varietal and appellation differ from the application)

**Target file:** `public/samples/labels/hawthorne-cabernet.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat unrolled front label, ~1024×1024 (wine labels are often near-square), photorealistic, neutral light-gray studio background.

**What it tests:** the label meets every requirement, so on its own it **Looks good**. It declares **"Merlot"** from **"Sonoma County"**, so entering **"Cabernet Sauvignon"** as the application's class/type shows **Differs from the label** and the label **Needs a look**.

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
- [ ] **Varietal line reads exactly "MERLOT"** (deliberately not Cabernet Sauvignon)
- [ ] **Appellation reads exactly "Sonoma County"** (deliberately not Napa Valley)
- [ ] Producer line includes "Hawthorne Cellars, Inc." and "Healdsburg, California"
- [ ] ABV reads "13.5% ALC/VOL"
- [ ] Net contents reads "750 mL"
- [ ] Government warning complete and verbatim
- [ ] Flat label, not a 3D bottle

Keep Merlot and Sonoma County when regenerating; they are deliberate.
