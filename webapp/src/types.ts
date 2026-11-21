// Shapes of the server's answers (kept in step with src/api/routes).

import type { Currency } from "@shared/money.ts";
import type { DayState, EventType } from "@shared/attendance.ts";

export type Role = "OWNER" | "ADMIN" | "WORKER" | "NONE";

export interface Me {
  user: {
    id: number;
    telegramName: string;
    fullName: string | null;
    phone: string | null;
    language: string;
    introSeen: string[];
    writeAccess: boolean;
  };
  needs: { consent: boolean; phone: boolean; name: boolean };
  role: Role;
  isStaff: boolean;
  /** The current company (null = none yet). Screens inside a company can rely on it. */
  company: {
    id: number;
    name: string;
    currency: Currency;
    /** ok, or blocked by the platform owner (suspended) or by the paid-until date (expired). */
    state: "ok" | "suspended" | "expired";
    /** Only for owners: the last paid day. */
    paidUntil: string | null;
  } | null;
  /** All companies where this person has an active membership. */
  companies: { id: number; name: string; role: Role }[];
  /** A platform owner (OWNER_TELEGRAM_IDS): may add and stop companies. */
  platform: boolean;
  branches: { id: number; name: string; timezone: string }[];
  adminBranchIds: number[];
  startParam: string | null;
  botUsername: string;
}

export interface DayResult {
  date: string;
  branchId: number;
  status: string;
  startMin: number | null;
  endMin: number | null;
  scheduledMin: number;
  lateMin: number;
  earlyMin: number;
  breakMin: number;
  overageMin: number;
  overtimeMin: number;
  workedMin: number;
  amount: number | null;
  earned: number;
  computedEarned: number;
  manualEarned: number | null;
  autoClosed: boolean;
  flags: string[];
  needsReview: boolean;
  reviewedAt: string | null;
}

export interface EventItem {
  id: number;
  type: EventType;
  time: string;
  localTime: string;
  distanceM: number | null;
  accuracy: number | null;
  source: "APP" | "ADMIN" | "AUTO";
  status: "ACCEPTED" | "REJECTED";
  rejectReason: string | null;
  voided: boolean;
  flags: string[];
  videoUrl: string | null;
  branchName: string | null;
}

export interface Today {
  date: string;
  branch: { id: number; name: string; timezone: string } | null;
  schedule: { startMin: number; endMin: number } | null;
  earliestCheckInMin: number | null;
  /** From this local minute a check-out may carry the "Ish tugadi" tick (null = not today). */
  workOverFromMin: number | null;
  workOverPercent: number;
  state: DayState;
  actions: EventType[];
  events: EventItem[];
  result: DayResult | null;
  breakAllowanceMin: number;
  streak: number;
  week: { onTime: number; workDays: number };
  month: { earned: number; max: number; timesLate: number };
  currency: Currency;
}

export interface Branch {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  timezone: string;
  qrVersion: number;
  qrMode: "STATIC" | "ROTATING";
  breakAllowanceMin: number;
  graceMin: number;
  graceMode: "FULL" | "AFTER_GRACE";
  active: boolean;
  workerCount?: number;
}

export interface BranchDetail extends Branch {
  qr: { svg: string; version: number; pngUrl: string; posterUrl: string; fileBase: string };
}

export interface Member {
  memberId: number;
  userId: number;
  name: string;
  phone: string | null;
  username: string | null;
  position: string;
  defaultDailyAmount: number | null;
  active: boolean;
  joinedAt: string;
  otherBranches: { id: number; name: string }[];
}

export interface Invite {
  id: number;
  role: "WORKER" | "ADMIN";
  expiresAt: string;
  maxUses: number | null;
  uses: number;
  /** Short code the worker types in the app. */
  code: string | null;
  /** t.me/<bot>?start=inv_… (always works). */
  link: string;
  /** t.me/<bot>/<app>?startapp=inv_… (needs the Mini App registered in BotFather). */
  appLink: string;
}

export interface Device {
  id: number;
  name: string;
  lastSeenAt: string | null;
}

export interface Person {
  userId: number;
  name: string;
  phone: string | null;
  username: string | null;
  role: Role;
  adminBranchIds: number[];
}

export interface PlatformCompany {
  id: number;
  name: string;
  active: boolean;
  paidUntil: string | null;
  maxWorkers: number | null;
  note: string;
  currency: "UZS" | "USD";
  groupTitle: string | null;
  hasGroup: boolean;
  state: "ok" | "suspended" | "expired";
  /** Days until paid-until (negative = already over), null = no end date. */
  daysLeft: number | null;
  workers: number;
  owners: { userId: number; telegramId: string; name: string | null; opened: boolean }[];
  createdAt: string;
  stats?: { branches: number; checkIns30: number; lastActivity: string | null };
}

export interface AttemptResult {
  ok: boolean;
  eventType: EventType;
  reason?: string;
  params?: Record<string, string | number>;
  serverTime?: string;
  localTime?: string;
  distanceM?: number | null;
  radiusM?: number;
  lateMin?: number;
  branchName?: string;
  workOver?: { present: number; ticked: number; needed: number; forgiven: boolean; counted: boolean };
}
