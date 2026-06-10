# Label image-gen prompt — Scenario 04: Ironwood IPA (missing government warning)

**Target file:** `public/samples/applications/04-ironwood-ipa/label.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat unrolled 12 fl. oz. can label, ~1536×1024 landscape (cans unroll wide), photorealistic, neutral light-gray studio background.

**Intentional mismatch:** The Government Warning is **deliberately omitted from this label**. All cross-check fields (brand, fanciful name, producer, type) match the application — but the mandatory 27 CFR §16 Government Warning text is absent entirely. The verify pipeline should flag a label-only rule failure (missing mandatory warning) while reporting all cross-checks as pass.

---

## Prompt

> Create a photorealistic, flat, unrolled side label for a 12 fl. oz. craft beer can. Modern Appalachian craft-beer aesthetic: matte charcoal background, hand-illustrated hop cone and iron forge anvil motif in the upper third, warm amber and cream type, slight metallic foil on the brand. Render as a flat unrolled can wrap laid on a neutral light-gray studio surface, evenly lit, slight aluminum sheen. Do NOT show a 3D can.
>
> The label must contain the following text exactly:
>
> - Upper third center, brand mark, large bold sans-serif uppercase: **IRONWOOD BREWING**
> - Below, large display script or condensed serif: **Hop Forge IPA**
> - Middle illustration: stylized hop cone and forge anvil
> - Below illustration, small sans-serif: **Brewed and canned by Ironwood Brewing Co. · Asheville, North Carolina**
> - Lower left, small sans-serif: **6.8% ALC/VOL**
> - Lower right, small sans-serif: **12 FL. OZ. (355 mL)**
> - Small QR-code-like square in the lower right corner area
> - Small ingredients/nutrition strip along one edge with placeholder text like **"INGREDIENTS: WATER, MALTED BARLEY, HOPS, YEAST"** and a small barcode
>
> **DO NOT include any "GOVERNMENT WARNING" text anywhere on this label.** Leave that area as part of the artwork instead. This is intentional — the label is missing its mandatory federal warning.
>
> Output the label only, no can, no glass, no background props.

## Verification checklist after generation

- [ ] Brand reads exactly **IRONWOOD BREWING**
- [ ] Fanciful name reads **"Hop Forge IPA"**
- [ ] Producer line includes "Ironwood Brewing Co." and "Asheville, North Carolina"
- [ ] ABV reads "6.8% ALC/VOL"
- [ ] Net contents reads "12 FL. OZ." (or "12 FL OZ" — either is acceptable)
- [ ] **No "GOVERNMENT WARNING" text appears anywhere on the label** ← this is the test
- [ ] Flat label, not a 3D can

If a Government Warning sneaks in, regenerate with a more explicit instruction to omit it. The whole point of this scenario is the missing warning.
