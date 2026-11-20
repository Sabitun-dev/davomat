-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "attendance_events" ADD COLUMN     "work_over" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "invites_code_key" ON "invites"("code");

