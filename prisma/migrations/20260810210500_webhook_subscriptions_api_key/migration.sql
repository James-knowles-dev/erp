-- AlterTable
ALTER TABLE "erp_connections" ADD COLUMN     "api_key_hash" TEXT;

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event_types" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_subscriptions_connection_id_idx" ON "webhook_subscriptions"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "erp_connections_api_key_hash_key" ON "erp_connections"("api_key_hash");

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

