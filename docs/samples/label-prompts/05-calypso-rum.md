# Label image-gen prompt — Scenario 05: Calypso Sands Rum (producer mismatch + ABV format)

**Target file:** `public/samples/applications/05-calypso-rum/label.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat unrolled front label, ~1024×1280 portrait, photorealistic, neutral light-gray studio background.

**Two intentional mismatches:**
1. **Producer drift (cross-check fail):** application names *Calypso Sands Distilling, Inc., Miami, FL* as the applicant, but the label's bottler statement reads **"Bottled by Tropical Spirits LLC, San Juan, Puerto Rico"** — a different entity entirely.
2. **ABV format (label-only rule fail):** the label shows ABV as **"80 PROOF"** with **no `% ALC/VOL` figure**. TTB requires the `% alcohol by volume` figure for distilled spirits.

---

## Prompt

> Create a photorealistic, flat, unrolled front label for a 750 mL bottle of aged Caribbean rum. Warm tropical aesthetic: sun-bleached parchment background, deep teal and burnt-amber accents, an engraved illustration of a Caribbean schooner and palm-lined shore across the upper third, rope-twist border. Render as a flat label laid on a neutral light-gray studio surface, evenly lit, slight aged-paper texture. Do NOT show a 3D bottle.
>
> The label must contain the following text exactly:
>
> - Top center, large engraved serif, all caps: **CALYPSO SANDS**
> - Below, italic script serif: *Aged Caribbean Rum*
> - Middle: engraved schooner illustration with palms
> - Below illustration, small serif: **Aged 7 Years in Oak**
> - Lower center, small serif (THIS IS THE INTENTIONAL MISMATCH): **Bottled by Tropical Spirits LLC · San Juan, Puerto Rico**
> - Lower left, small sans-serif (THIS IS THE INTENTIONAL FORMAT ISSUE — proof only, NO % ABV): **80 PROOF**
> - Lower right, small sans-serif: **750 mL**
> - Bottom strip, narrow sans-serif at minimum legible size, exactly this text in a single block:
>
>   `GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`
>
> Render every character of the government warning verbatim. Output the label only, no bottle, no glass, no background props.

## Verification checklist after generation

- [ ] Brand reads exactly **CALYPSO SANDS**
- [ ] Fanciful name reads **"Aged Caribbean Rum"**
- [ ] **Bottler line reads exactly "Bottled by Tropical Spirits LLC · San Juan, Puerto Rico"** (intentional mismatch — application says Calypso Sands Distilling, Miami, FL)
- [ ] **ABV reads only "80 PROOF" — there must be NO "% ALC/VOL" anywhere on the label** (intentional format issue)
- [ ] Net contents reads "750 mL"
- [ ] Government warning complete and verbatim
- [ ] Flat label, not a 3D bottle

Both mismatches must be present for this scenario to exercise its full failure path. If the image gen adds "% ALC/VOL" automatically, regenerate with an even more explicit instruction.
