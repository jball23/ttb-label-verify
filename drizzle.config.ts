import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

// `generate` only needs the dialect — `push` and `studio` need a live URL.
// We fall back to a sentinel so the config still parses for generation.
const url = process.env.DATABASE_URL ?? 'postgres://placeholder/none';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  casing: 'snake_case',
});
