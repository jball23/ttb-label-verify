# Label image-gen prompt — Scenario 02: Silver Birch Vodka (brand-name drift)

**Target file:** `public/samples/applications/02-silver-birch-vodka/label.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat unrolled front label, ~1024×1280 portrait, photorealistic, neutral light-gray studio background.

**Intentional mismatch:** The application's Item 6 "Brand Name" is **"Silver Birch"** and Item 7 "Fanciful Name" is **"Premium Vodka"** — but on this label the brand is printed as the combined string **"Silver Birch Premium"**, leaving "Vodka" alone as the class/type line. The verify pipeline should flag a brand-name cross-check failure.

---

## Prompt

> Create a photorealistic, flat, unrolled front label for a premium vodka bottle. Modern Scandinavian-minimalist design: matte white background, thin frost-blue geometric birch-tree linework along the left and right edges, brushed silver foil accents. Render as a flat label laid on a neutral light-gray studio surface, evenly lit, slight paper texture. Do NOT show a 3D bottle.
>
> The label must contain the following text exactly:
>
> - Top center, large modern sans-serif, letter-spaced uppercase: **SILVER BIRCH PREMIUM**
> - Just below, smaller uppercase sans-serif with wide tracking: **VODKA**
> - Middle area, small mark: a minimalist single birch tree silhouette
> - Below the mark, very small sans-serif: **Distilled and bottled by Northern Spirits Co. · Portland, Oregon**
> - Lower left, sans-serif: **40% ALC/VOL (80 PROOF)**
> - Lower right, sans-serif: **750 mL**
> - Bottom strip, narrow sans-serif at minimum legible size, exactly this text in a single block:
>
>   `GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`
>
> Render every character of the government warning verbatim. Output the label only, no bottle, no glass, no background props.

## Verification checklist after generation

- [ ] **Brand line reads exactly "SILVER BIRCH PREMIUM"** (this is the intentional mismatch — application says brand is just "Silver Birch")
- [ ] Class/type line below reads just **"VODKA"**
- [ ] Producer line includes "Northern Spirits Co." and "Portland, Oregon"
- [ ] ABV reads "40% ALC/VOL" and "80 PROOF"
- [ ] Net contents reads "750 mL"
- [ ] Government warning complete and verbatim
- [ ] Flat label, not a 3D bottle

If anything other than the brand line is wrong, regenerate; the wrong brand IS the test.
