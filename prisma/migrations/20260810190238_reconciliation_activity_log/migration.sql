-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "shopify_order_id" TEXT NOT NULL,
    "shopify_total" DECIMAL(65,30),
    "erp_total" DECIMAL(65,30),
    "status" TEXT NOT NULL,
    "discrepancy_reason" TEXT,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_records_connection_id_status_idx" ON "reconciliation_records"("connection_id", "status");

-- CreateIndex
CREATE INDEX "activity_log_connection_id_occurred_at_idx" ON "activity_log"("connection_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
