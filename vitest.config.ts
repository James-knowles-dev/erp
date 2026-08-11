import { configDefaults, defineConfig } from "vitest/config";

// Default config for `npm run test` -- deliberately Postgres-independent (no globalSetup, no real
// DB), matching how this repo's CI has always run. A dedicated config file (this one, preferred
// by Vitest over vite.config.ts when both exist) keeps that boundary explicit and avoids touching
// the Remix/Vite build config at all -- see vitest.integration.config.ts for the real-DB suite.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
