// Company-wide settings. Stored as JSON in companies.settings; missing keys use these defaults.

export interface CompanySettings {
  /** Reject a GPS reading whose accuracy is worse than this (metres). */
  gpsAccuracyLimitM: number;
  /** Extra metres allowed beyond the radius. 0 = strict. */
  geofenceToleranceM: number;
  /** Earliest check-in, minutes before scheduled start. */
  earliestCheckInMin: number;
  /** An open day is closed automatically this many minutes after scheduled end. */
  autoCloseAfterMin: number;
  /** A group video counts for an event from this many minutes before ... */
  videoBeforeMin: number;
  /** ... to this many minutes after. */
  videoAfterMin: number;
  /** Bot replies under the group video with the event summary. */
  botReplyUnderVideo: boolean;
  /** Flag days with a scan but no group video. */
  flagMissingVideo: boolean;
  inviteExpiryDays: number;
  /** Raw GPS is removed from events older than this. */
  gpsRetentionMonths: number;
  /** Max check-in attempts per worker in 5 minutes. */
  rateLimitPer5Min: number;
  /** Remind a worker this many minutes after start if they have not checked in. 0 = off. */
  remindCheckInAfterMin: number;
  /** Remind a worker this many minutes after end if they have not checked out. 0 = off. */
  remindCheckOutAfterMin: number;
  morningSummary: boolean;
  dailyFlagSummary: boolean;
  monthlyPayrollMessage: boolean;
  /** Pay time worked outside the scheduled hours at the same per-minute rate. */
  overtimeEnabled: boolean;
  /** With overtime on: also count arriving before the scheduled start. */
  overtimeIncludeEarly: boolean;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  gpsAccuracyLimitM: 50,
  geofenceToleranceM: 0,
  earliestCheckInMin: 180,
  autoCloseAfterMin: 120,
  videoBeforeMin: 15,
  videoAfterMin: 5,
  botReplyUnderVideo: false,
  flagMissingVideo: true,
  inviteExpiryDays: 7,
  gpsRetentionMonths: 12,
  rateLimitPer5Min: 10,
  remindCheckInAfterMin: 10,
  remindCheckOutAfterMin: 30,
  morningSummary: true,
  dailyFlagSummary: true,
  monthlyPayrollMessage: true,
  overtimeEnabled: true,
  overtimeIncludeEarly: true,
};

const LIMITS: Partial<Record<keyof CompanySettings, [number, number]>> = {
  gpsAccuracyLimitM: [5, 500],
  geofenceToleranceM: [0, 200],
  earliestCheckInMin: [0, 720],
  autoCloseAfterMin: [15, 720],
  videoBeforeMin: [0, 120],
  videoAfterMin: [0, 120],
  inviteExpiryDays: [1, 90],
  gpsRetentionMonths: [1, 60],
  rateLimitPer5Min: [3, 100],
  remindCheckInAfterMin: [0, 240],
  remindCheckOutAfterMin: [0, 240],
};

/** Merges stored JSON with defaults and throws away unknown or out-of-range values. */
export function parseSettings(raw: unknown): CompanySettings {
  const out: CompanySettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CompanySettings)[]) {
    const value = src[key];
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === "boolean" && typeof value === "boolean") (out as unknown as Record<string, unknown>)[key] = value;
    if (typeof def === "number" && typeof value === "number" && Number.isFinite(value)) {
      const [min, max] = LIMITS[key] ?? [0, Number.MAX_SAFE_INTEGER];
      (out as unknown as Record<string, unknown>)[key] = Math.min(max, Math.max(min, Math.round(value)));
    }
  }
  return out;
}
