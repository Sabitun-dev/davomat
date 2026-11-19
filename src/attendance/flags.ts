// Suspicious-pattern flags (spec 7). They never block the worker; the day is only marked for review.

import { haversineM } from "./geo.ts";

export interface PastAttempt {
  lat: number | null;
  lng: number | null;
  serverTime: Date;
  status: "ACCEPTED" | "REJECTED";
  rejectReason: string | null;
}

export function suspiciousFlags(input: {
  lat: number;
  lng: number;
  accuracy: number;
  now: Date;
  distanceM: number;
  radiusM: number;
  /** This worker's recent attempts (newest first), excluding this one. */
  recent: PastAttempt[];
  /** Another worker used the same device today. */
  sharedDevice: boolean;
}): string[] {
  const flags: string[] = [];
  if (input.accuracy === 0) flags.push("zero_accuracy");

  // Real GPS jitters; the exact same coordinates again point to a fake-location app.
  const same = (a: PastAttempt) => a.status === "ACCEPTED" && a.lat === input.lat && a.lng === input.lng;
  if (input.recent.some(same)) flags.push("repeated_coords");

  // Faster than 150 km/h over more than 2 km since the last reading.
  const last = input.recent.find((a) => a.lat !== null && a.lng !== null);
  if (last) {
    const metres = haversineM(last.lat!, last.lng!, input.lat, input.lng);
    const hours = Math.max(1, (input.now.getTime() - last.serverTime.getTime()) / 1000) / 3600;
    if (metres > 2000 && metres / 1000 / hours > 150) flags.push("impossible_jump");
  }

  if (input.sharedDevice) flags.push("shared_device");

  // Accepted right at the edge after several "too far" fails in the last 15 minutes.
  const fails = input.recent.filter(
    (a) => a.status === "REJECTED" && a.rejectReason === "too_far" && input.now.getTime() - a.serverTime.getTime() <= 15 * 60_000,
  ).length;
  if (fails >= 2 && input.distanceM >= 0.8 * input.radiusM) flags.push("edge_after_fails");

  return flags;
}
