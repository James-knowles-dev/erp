-- AlterTable
ALTER TABLE "erp_connections" ADD COLUMN     "shadow_mode_started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'live';

