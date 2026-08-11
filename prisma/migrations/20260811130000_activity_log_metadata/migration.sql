-- Security hardening pass per erp-connector-fixes-spec.md (2026-08-11 follow-up review).
-- F1 follow-up: activity_log.metadata carries structured PII for entries like gdpr_data_request's
-- export dump, so a later customers/redact request can find and scrub the PII fields precisely
-- (via gdpr.server.ts's redactOrderPayload) instead of only being able to substring-match the
-- customer's email inside the free-text `message` column.

-- AlterTable
ALTER TABLE "activity_log" ADD COLUMN "metadata" JSONB;
