-- AlterTable
ALTER TABLE "shops" ADD COLUMN     "agency_invite_code" TEXT,
ADD COLUMN     "agency_invite_code_used_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "agencies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branding_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_users" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_client_links" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "agency_client_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_user_client_access" (
    "id" TEXT NOT NULL,
    "agency_user_id" TEXT NOT NULL,
    "agency_client_link_id" TEXT NOT NULL,

    CONSTRAINT "agency_user_client_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_templates" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "erp_type" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "created_from_connection_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_users_email_key" ON "agency_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agency_user_client_access_agency_user_id_agency_client_link_key" ON "agency_user_client_access"("agency_user_id", "agency_client_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "shops_agency_invite_code_key" ON "shops"("agency_invite_code");

-- AddForeignKey
ALTER TABLE "agency_users" ADD CONSTRAINT "agency_users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_links" ADD CONSTRAINT "agency_client_links_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_client_links" ADD CONSTRAINT "agency_client_links_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_user_client_access" ADD CONSTRAINT "agency_user_client_access_agency_user_id_fkey" FOREIGN KEY ("agency_user_id") REFERENCES "agency_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_user_client_access" ADD CONSTRAINT "agency_user_client_access_agency_client_link_id_fkey" FOREIGN KEY ("agency_client_link_id") REFERENCES "agency_client_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

