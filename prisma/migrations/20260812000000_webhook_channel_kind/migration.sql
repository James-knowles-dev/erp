-- AlterTable
ALTER TABLE "webhook_subscriptions" ADD COLUMN     "channel_kind" TEXT NOT NULL DEFAULT 'generic';
