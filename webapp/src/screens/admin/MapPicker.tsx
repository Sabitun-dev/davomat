// Leaflet + OpenStreetMap. Loaded only when an admin opens the branch editor.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function MapPicker({
  lat,
  lng,
  radiusM,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  radiusM: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pin = useRef<L.CircleMarker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView(
      lat !== null && lng !== null ? [lat, lng] : [41.3111, 69.2797],
      lat !== null ? 17 : 12,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => pickRef.current(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || lat === null || lng === null) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--app-accent").trim() || "#6d4aff";
    if (!pin.current) {
      circle.current = L.circle([lat, lng], { radius: radiusM, color: accent, weight: 2, fillOpacity: 0.15 }).addTo(m);
      pin.current = L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 3, fillColor: accent, fillOpacity: 1 }).addTo(m);
      m.setView([lat, lng], Math.max(m.getZoom(), 17));
    } else {
      pin.current.setLatLng([lat, lng]);
      circle.current!.setLatLng([lat, lng]).setRadius(radiusM);
      if (!m.getBounds().contains([lat, lng])) m.panTo([lat, lng]);
    }
  }, [lat, lng, radiusM]);

  return <div ref={box} className="h-[300px] w-full overflow-hidden rounded-[20px] shadow-soft" style={{ zIndex: 0 }} />;
}
