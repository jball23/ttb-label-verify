# Label image-gen prompt — Scenario 01: Ridge Creek Bourbon (clean compliant)

**Target file:** `public/samples/applications/01-ridge-creek-bourbon/label.jpg`
**Recommended tool:** Google Nano Banana / Gemini image gen, OpenAI gpt-image-1, or ChatGPT image gen
**Output:** flat, unrolled front label artwork (NOT a 3D bottle photo). Roughly 1024×1280, portrait, photorealistic print-ready label, on a neutral light gray studio background.

---

## Prompt

> Create a photorealistic, flat, unrolled front label for a bourbon whiskey bottle. The label should look like a real printed and embossed label, designed in a traditional Kentucky bourbon house style: cream paper background, deep navy and gold accents, ornate engraved frame border, small woodcut illustration of a limestone creek and bourbon barrel in the upper center.
>
> Render the label as if it has been carefully peeled off a 750 mL bottle and laid flat on a neutral light gray studio surface, lit evenly with a slight paper texture. Do NOT show a 3D bottle.
>
> The label must contain the following text, rendered cleanly and legibly with no spelling errors or paraphrasing:
>
> - Top center, large serif display type, all caps: **RIDGE CREEK**
> - Just below, smaller italic serif: *Kentucky Straight Bourbon Whiskey*
> - Mid-label woodcut illustration (limestone creek + barrel)
> - Below illustration, small but readable serif: **Distilled and Bottled by Ridge Creek Distillery, LLC · Bardstown, Kentucky**
> - Lower left, sans-serif: **45% ALC/VOL (90 PROOF)**
> - Lower right, sans-serif: **750 mL**
> - Bottom strip, narrow sans-serif at minimum legible size, in a horizontal box across the full label width, exactly this text in a single block:
>
>   `GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.`
>
> Render every character of the government warning verbatim. Use bold or all-caps where indicated. Do not abbreviate, paraphrase, or replace any phrase. Output the label only, no bottle, no glass, no background props.

## Verification checklist after generation

- [ ] Brand reads exactly **RIDGE CREEK**
- [ ] Class/type reads exactly **Kentucky Straight Bourbon Whiskey**
- [ ] Producer line includes "Ridge Creek Distillery, LLC" and "Bardstown, Kentucky"
- [ ] ABV reads "45% ALC/VOL" and "90 PROOF"
- [ ] Net contents reads "750 mL"
- [ ] Government warning is **complete, verbatim, with prefix**
- [ ] Image is a flat label (not a 3D bottle)

If any field is wrong, regenerate with a follow-up prompt like: *"Same image but change the bottom strip text to exactly: \<paste verbatim warning\>."*
