-- CreateTable
CREATE TABLE "erp_connections" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "erp_type" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "credentials_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3),
    "last_successful_sync_at" TIMESTAMP(3),

    CONSTRAINT "erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "shopify_field" TEXT NOT NULL,
    "erp_field" TEXT NOT NULL,
    "transform_rule" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edge_case_rules" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "rule_value" TEXT NOT NULL,

    CONSTRAINT "edge_case_rules_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edge_case_rules" ADD CONSTRAINT "edge_case_rules_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
