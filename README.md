# TTB Label Verification

AI-assisted compliance verification for alcohol beverage labels. Built as a take-home prototype for the U.S. Treasury / TTB.

**Full README lands in U8 after the build completes.**

## Quick start (developer)

```bash
npm install
cp .env.example .env.local   # fill in OPENAI_API_KEY, DEMO_PASSWORD, DEMO_PASSWORD_COOKIE_SECRET
npm run dev
```

Visit `http://localhost:3000`.

## Test

```bash
npm test          # run once
npm run typecheck # tsc --noEmit
npm run lint      # next lint
```

## Eval

```bash
npm run eval      # runs the LLM extraction eval suite, posts traces to Langfuse
```

See `docs/plans/2026-06-09-001-feat-ttb-label-verify-plan.md` for the full plan.
