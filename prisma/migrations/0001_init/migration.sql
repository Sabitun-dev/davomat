-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'WORKER');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('UZS', 'USD');

-- CreateEnum
CREATE TYPE "QrMode" AS ENUM ('STATIC', 'ROTATING');

-- CreateEnum
CREATE TYPE "GraceMode" AS ENUM ('FULL', 'AFTER_GRACE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('APP', 'ADMIN', 'AUTO');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ON_TIME', 'LATE', 'ABSENT', 'DAY_OFF', 'EXTRA_DAY');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('BONUS', 'FINE');

-- CreateTable
CREATE TABLE "app_config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'UZS',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "last_name" TEXT NOT NULL DEFAULT '',
    "username" TEXT,
    "full_name" TEXT,
    "phone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'uz',
    "consent_at" TIMESTAMP(3),
    "name_confirmed_at" TIMESTAMP(3),
    "intro_seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "write_access" BOOLEAN NOT NULL DEFAULT false,
    "bot_blocked" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_branches" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "branch_id" INTEGER NOT NULL,

    CONSTRAINT "admin_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL DEFAULT 25,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "qr_version" INTEGER NOT NULL DEFAULT 1,
    "qr_mode" "QrMode" NOT NULL DEFAULT 'STATIC',
    "break_allowance_min" INTEGER NOT NULL DEFAULT 60,
    "grace_min" INTEGER NOT NULL DEFAULT 0,
    "grace_mode" "GraceMode" NOT NULL DEFAULT 'FULL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_members" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "default_daily_amount" INTEGER,
    "position" TEXT NOT NULL DEFAULT '',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "branch_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'WORKER',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "created_by" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "display_devices" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "display_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_templates" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "weekday" INTEGER NOT NULL,
    "start_min" INTEGER,
    "end_min" INTEGER,
    "day_off" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "schedule_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_overrides" (
    "id" SERIAL NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "date" TEXT NOT NULL,
    "start_min" INTEGER,
    "end_min" INTEGER,
    "day_off" BOOLEAN NOT NULL DEFAULT false,
    "holiday" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "schedule_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_amounts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "daily_amounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_events" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "branch_id" INTEGER,
    "local_date" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "server_time" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "distance_m" INTEGER,
    "status" "EventStatus" NOT NULL,
    "reject_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "device_id" TEXT,
    "user_agent" TEXT,
    "source" "EventSource" NOT NULL DEFAULT 'APP',
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_notes" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "user_telegram_id" BIGINT NOT NULL,
    "user_id" INTEGER,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "linked_event_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_results" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "branch_id" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "status" "DayStatus" NOT NULL,
    "start_min" INTEGER,
    "end_min" INTEGER,
    "scheduled_min" INTEGER NOT NULL DEFAULT 0,
    "late_min" INTEGER NOT NULL DEFAULT 0,
    "early_min" INTEGER NOT NULL DEFAULT 0,
    "break_min" INTEGER NOT NULL DEFAULT 0,
    "overage_min" INTEGER NOT NULL DEFAULT 0,
    "worked_min" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER,
    "earned" INTEGER NOT NULL DEFAULT 0,
    "manual_earned" INTEGER,
    "check_in_at" TIMESTAMP(3),
    "check_out_at" TIMESTAMP(3),
    "auto_closed" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" INTEGER,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustments" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_locks" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "locked_by" INTEGER NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "comment" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications_sent" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "day_key" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_updates" (
    "update_id" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_updates_pkey" PRIMARY KEY ("update_id")
);

-- CreateTable
CREATE TABLE "scheduler_runs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,

    CONSTRAINT "scheduler_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_company_id_key" ON "memberships"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_branches_user_id_branch_id_key" ON "admin_branches"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "branches_company_id_idx" ON "branches"("company_id");

-- CreateIndex
CREATE INDEX "branch_members_user_id_idx" ON "branch_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_members_branch_id_user_id_key" ON "branch_members"("branch_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "display_devices_key_hash_key" ON "display_devices"("key_hash");

-- CreateIndex
CREATE INDEX "schedule_templates_branch_id_user_id_idx" ON "schedule_templates"("branch_id", "user_id");

-- CreateIndex
CREATE INDEX "schedule_overrides_branch_id_date_idx" ON "schedule_overrides"("branch_id", "date");

-- CreateIndex
CREATE INDEX "daily_amounts_branch_id_date_idx" ON "daily_amounts"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_amounts_user_id_branch_id_date_key" ON "daily_amounts"("user_id", "branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_events_idempotency_key_key" ON "attendance_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "attendance_events_user_id_local_date_idx" ON "attendance_events"("user_id", "local_date");

-- CreateIndex
CREATE INDEX "attendance_events_branch_id_local_date_idx" ON "attendance_events"("branch_id", "local_date");

-- CreateIndex
CREATE INDEX "attendance_events_user_id_server_time_idx" ON "attendance_events"("user_id", "server_time");

-- CreateIndex
CREATE INDEX "attendance_events_device_id_local_date_idx" ON "attendance_events"("device_id", "local_date");

-- CreateIndex
CREATE UNIQUE INDEX "video_notes_linked_event_id_key" ON "video_notes"("linked_event_id");

-- CreateIndex
CREATE INDEX "video_notes_user_id_sent_at_idx" ON "video_notes"("user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_notes_chat_id_message_id_key" ON "video_notes"("chat_id", "message_id");

-- CreateIndex
CREATE INDEX "daily_results_branch_id_date_idx" ON "daily_results"("branch_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_results_user_id_date_key" ON "daily_results"("user_id", "date");

-- CreateIndex
CREATE INDEX "adjustments_company_id_month_idx" ON "adjustments"("company_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "month_locks_company_id_month_key" ON "month_locks"("company_id", "month");

-- CreateIndex
CREATE INDEX "audit_log_company_id_entity_entity_id_idx" ON "audit_log"("company_id", "entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_sent_kind_chat_id_day_key_key" ON "notifications_sent"("kind", "chat_id", "day_key");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_branches" ADD CONSTRAINT "admin_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_branches" ADD CONSTRAINT "admin_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_members" ADD CONSTRAINT "branch_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "display_devices" ADD CONSTRAINT "display_devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_templates" ADD CONSTRAINT "schedule_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_amounts" ADD CONSTRAINT "daily_amounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_amounts" ADD CONSTRAINT "daily_amounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_notes" ADD CONSTRAINT "video_notes_linked_event_id_fkey" FOREIGN KEY ("linked_event_id") REFERENCES "attendance_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_results" ADD CONSTRAINT "daily_results_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_locks" ADD CONSTRAINT "month_locks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

