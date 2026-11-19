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
  company: { id: number; name: string; currency: Currency };
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
  workedMin: number;
  amount: number | null;
  earned: number;
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
}
