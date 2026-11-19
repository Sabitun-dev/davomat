import { describe, expect, it } from "vitest";
import { checkGeofence, haversineM } from "../src/attendance/geo.ts";

describe("haversine", () => {
  it("one degree of latitude is about 111.2 km", () => {
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111195, -1);
  });

  it("Tashkent to Samarkand is about 270 km", () => {
    const d = haversineM(41.2995, 69.2401, 39.6542, 66.9597);
    expect(d / 1000).toBeGreaterThan(260);
    expect(d / 1000).toBeLessThan(280);
  });

  it("the same point is 0 m", () => {
    expect(haversineM(41.3, 69.2, 41.3, 69.2)).toBe(0);
  });

  it("about 25 m north", () => {
    // 25 m / 111195 m per degree
    expect(haversineM(41.3, 69.2, 41.3 + 25 / 111195, 69.2)).toBeCloseTo(25, 0);
  });
});

describe("geofence", () => {
  const branch = { lat: 41.3, lng: 69.2, radiusM: 25 };
  const north = (m: number) => 41.3 + m / 111195;

  it("inside the radius with good accuracy is ok", () => {
    expect(checkGeofence({ lat: north(12), lng: 69.2, accuracy: 10, branch, accuracyLimitM: 50 })).toEqual({ ok: true, distanceM: 12 });
  });

  it("exactly at the radius is ok, 1 m more is too far", () => {
    expect(checkGeofence({ lat: north(25), lng: 69.2, accuracy: 10, branch, accuracyLimitM: 50 }).ok).toBe(true);
    const far = checkGeofence({ lat: north(26.2), lng: 69.2, accuracy: 10, branch, accuracyLimitM: 50 });
    expect(far).toEqual({ ok: false, reason: "too_far", distanceM: 26 });
  });

  it("good accuracy never stretches the radius", () => {
    const r = checkGeofence({ lat: north(83), lng: 69.2, accuracy: 49, branch, accuracyLimitM: 50 });
    expect(r).toEqual({ ok: false, reason: "too_far", distanceM: 83 });
  });

  it("weak GPS is rejected even inside the radius", () => {
    const r = checkGeofence({ lat: north(5), lng: 69.2, accuracy: 70, branch, accuracyLimitM: 50 });
    expect(r).toEqual({ ok: false, reason: "weak_gps", distanceM: 5 });
  });

  it("missing accuracy counts as weak, missing location as no location", () => {
    expect(checkGeofence({ lat: north(5), lng: 69.2, accuracy: undefined, branch, accuracyLimitM: 50 }).ok).toBe(false);
    expect(checkGeofence({ lat: null, lng: null, accuracy: 5, branch, accuracyLimitM: 50 })).toEqual({
      ok: false,
      reason: "no_location",
      distanceM: null,
    });
  });

  it("tolerance setting adds metres", () => {
    expect(checkGeofence({ lat: north(30), lng: 69.2, accuracy: 10, branch, accuracyLimitM: 50, toleranceM: 10 }).ok).toBe(true);
  });
});
