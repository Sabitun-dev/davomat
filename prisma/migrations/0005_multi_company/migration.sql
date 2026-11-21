-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_company_id_fkey";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "created_by_user_id" INTEGER,
ADD COLUMN     "group_chat_id" BIGINT,
ADD COLUMN     "group_title" TEXT,
ADD COLUMN     "max_workers" INTEGER,
ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paid_until" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "current_company_id" INTEGER;

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "company_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "companies_group_chat_id_key" ON "companies"("group_chat_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_action_at_idx" ON "audit_log"("actor_user_id", "action", "at");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

