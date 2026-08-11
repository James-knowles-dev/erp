-- Fix pass per erp-connector-fixes-spec.md (2026-08-11 review).
-- F2: cascade deletes on every FK chain rooted at "shops" and "agency_client_links", so
-- shop/redact's `db.shop.deleteMany(...)` no longer fails with a foreign-key violation for any
-- shop that ever connected an ERP or linked an agency.
-- F4: content_fingerprint column + unique constraint on sync_jobs, closing the duplicate-push gap.
-- F13: missing indexes on field_mappings/edge_case_rules.connection_id.
-- F14: unique constraint on agency_client_links.shop_id ("one agency per shop").

-- F2: erp_connections -> shops
ALTER TABLE "erp_connections" DROP CONSTRAINT "erp_connections_shop_id_fkey";
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: field_mappings -> erp_connections
ALTER TABLE "field_mappings" DROP CONSTRAINT "field_mappings_connection_id_fkey";
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: edge_case_rules -> erp_connections
ALTER TABLE "edge_case_rules" DROP CONSTRAINT "edge_case_rules_connection_id_fkey";
ALTER TABLE "edge_case_rules" ADD CONSTRAINT "edge_case_rules_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: sync_jobs -> erp_connections
ALTER TABLE "sync_jobs" DROP CONSTRAINT "sync_jobs_connection_id_fkey";
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: reconciliation_records -> erp_connections
ALTER TABLE "reconciliation_records" DROP CONSTRAINT "reconciliation_records_connection_id_fkey";
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: activity_log -> erp_connections
ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_connection_id_fkey";
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: webhook_subscriptions -> erp_connections
ALTER TABLE "webhook_subscriptions" DROP CONSTRAINT "webhook_subscriptions_connection_id_fkey";
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "erp_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: agency_client_links -> shops
ALTER TABLE "agency_client_links" DROP CONSTRAINT "agency_client_links_shop_id_fkey";
ALTER TABLE "agency_client_links" ADD CONSTRAINT "agency_client_links_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2: agency_user_client_access -> agency_client_links (children of a link that may now cascade-delete)
ALTER TABLE "agency_user_client_access" DROP CONSTRAINT "agency_user_client_access_agency_client_link_id_fkey";
ALTER TABLE "agency_user_client_access" ADD CONSTRAINT "agency_user_client_access_agency_client_link_id_fkey" FOREIGN KEY ("agency_client_link_id") REFERENCES "agency_client_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F13: CreateIndex
CREATE INDEX "field_mappings_connection_id_idx" ON "field_mappings"("connection_id");

-- F13: CreateIndex
CREATE INDEX "edge_case_rules_connection_id_idx" ON "edge_case_rules"("connection_id");

-- F4: AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN "content_fingerprint" TEXT;

-- F4: CreateIndex
CREATE UNIQUE INDEX "sync_jobs_dedup_fingerprint_key" ON "sync_jobs"("connection_id", "entity_type", "shopify_reference_id", "content_fingerprint");

-- F14: CreateIndex
CREATE UNIQUE INDEX "agency_client_links_shop_id_key" ON "agency_client_links"("shop_id");
