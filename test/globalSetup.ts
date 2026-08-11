import { execSync } from "node:child_process";

// Runs once before the real-Postgres integration suite (vitest.integration.config.ts). Applies
// every Prisma migration to DATABASE_URL so app/sync/queue.dedup.integration.test.ts has a real
// schema (including the sync_jobs_dedup_fingerprint_key unique constraint it's actually testing)
// to run against.
//
// The "test" substring check is cheap insurance, not real safety -- this runs `prisma migrate
// deploy` and lets tests do real inserts/deletes, so a mistyped DATABASE_URL pointing at a real
// database would be destructive. It doesn't replace actually double-checking the URL before
// running this.
export default function setup(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Start the test database with " +
        "`docker compose -f docker-compose.test.yml up -d`, then set DATABASE_URL to " +
        "postgresql://postgres:postgres@localhost:55432/erp_test (see docker-compose.test.yml).",
    );
  }
  if (!databaseUrl.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run the integration suite against DATABASE_URL="${databaseUrl}" -- it doesn't ` +
        'contain "test". This suite runs real inserts/deletes; point it at the disposable database ' +
        "from docker-compose.test.yml, not a real one.",
    );
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
}
