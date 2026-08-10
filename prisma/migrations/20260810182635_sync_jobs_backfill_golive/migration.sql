-- AlterTable
ALTER TABLE "erp_connections" ADD COLUMN     "backfill_window" TEXT,
ADD COLUMN     "went_live_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "shopify_reference_id" TEXT,
    "erp_document_ref" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_jobs_connection_id_entity_type_shopify_reference_id_st_idx" ON "sync_jobs"("connection_id", "entity_type", "shopify_reference_id", "status");

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
