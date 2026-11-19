// Distance and geofence. Always computed on the server.

const EARTH_RADIUS_M = 6371008.8;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

export type GeofenceResult =
  | { ok: true; distanceM: number }
  | { ok: false; reason: "no_location" | "weak_gps" | "too_far"; distanceM: number | null };

/**
 * Strict rule: accuracy must be within the limit, and the reported point must be within the radius
 * (+ an optional tolerance, 0 by default). Accuracy is never used to stretch the radius.
 */
export function checkGeofence(input: {
  lat: unknown;
  lng: unknown;
  accuracy: unknown;
  branch: { lat: number; lng: number; radiusM: number };
  accuracyLimitM: number;
  toleranceM?: number;
}): GeofenceResult {
  if (!isValidCoord(input.lat, input.lng)) return { ok: false, reason: "no_location", distanceM: null };
  const lat = input.lat as number;
  const lng = input.lng as number;
  const distanceM = Math.round(haversineM(lat, lng, input.branch.lat, input.branch.lng));
  const accuracy = typeof input.accuracy === "number" && Number.isFinite(input.accuracy) ? input.accuracy : Infinity;
  if (accuracy < 0 || accuracy > input.accuracyLimitM) return { ok: false, reason: "weak_gps", distanceM };
  if (distanceM > input.branch.radiusM + (input.toleranceM ?? 0)) return { ok: false, reason: "too_far", distanceM };
  return { ok: true, distanceM };
}
