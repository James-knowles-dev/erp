import { defineConfig } from "vitest/config";

// Real-Postgres suite (erp-connector-fixes-spec.md F4 follow-up) -- separate from vitest.config.ts
// so `npm run test` never needs Docker/Postgres. Run via `npm run test:integration` after
// `docker compose -f docker-compose.test.yml up -d` and setting DATABASE_URL to point at it (see
// docker-compose.test.yml's header comment).
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    globalSetup: ["./test/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
