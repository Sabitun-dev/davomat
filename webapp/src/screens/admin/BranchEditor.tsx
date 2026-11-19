// New branch / edit branch: name, address, time zone, location on the map and the geofence.

import { lazy, Suspense, useState } from "react";
import { LocateFixed, Search } from "lucide-react";
import { api, invalidate } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { BottomActions, BottomSpacer } from "../../telegram/buttons.tsx";
import { getLocation } from "../../telegram/tg.ts";
import { Button, Card, Field, Input, Page, SectionTitle, Select, Skeleton, Stepper, errorText, useToast } from "../../ui/index.ts";
import type { Branch } from "../../types.ts";

const MapPicker = lazy(() => import("./MapPicker.tsx"));

export const TIMEZONES = [
  "Asia/Tashkent",
  "Asia/Samarkand",
  "Asia/Almaty",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Ashgabat",
  "Asia/Dubai",
  "Europe/Istanbul",
  "Europe/Moscow",
  "UTC",
];

export default function BranchEditor({ branch }: { branch?: Branch }) {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const [name, setName] = useState(branch?.name ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [timezone, setTimezone] = useState(branch?.timezone ?? "Asia/Tashkent");
  const [lat, setLat] = useState<number | null>(branch?.lat ?? null);
  const [lng, setLng] = useState<number | null>(branch?.lng ?? null);
  const [radius, setRadius] = useState(branch?.radiusM ?? 25);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ lat: string; lon: string; display_name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const useMine = async () => {
    setLocating(true);
    const r = await getLocation(15000);
    setLocating(false);
    if (!r.ok) return toast(t(r.reason === "denied" ? "rej.location_denied" : "rej.no_location"), "error");
    setLat(r.lat);
    setLng(r.lng);
    setAccuracy(Math.round(r.accuracy));
  };

  const search = async () => {
    if (query.trim().length < 3) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=uz,kz,kg,tj,tm,ru&q=${encodeURIComponent(query)}`,
      );
      setResults(await res.json());
    } catch {
      setResults([]);
    }
  };

  const save = async () => {
    if (lat === null || lng === null) return toast(t("err.bad_location"), "error");
    setBusy(true);
    try {
      const payload = { name, address, timezone, lat, lng, radiusM: radius };
      const saved = branch
        ? await api<Branch>(`/admin/branches/${branch.id}`, { method: "PATCH", body: payload })
        : await api<Branch>("/admin/branches", { body: payload });
      invalidate("/admin/branches");
      toast(branch ? t("c.saved") : t("b.created"));
      nav.pop();
      if (!branch) nav.push("branch", { id: saved.id });
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={branch ? t("b.edit") : t("b.new")} onBack={nav.pop}>
      <div className="flex flex-col gap-4">
        <Field label={t("b.name")}>
          <Input value={name} maxLength={80} placeholder={t("b.name_ph")} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("b.address")}>
          <Input value={address} maxLength={200} placeholder={t("b.address_ph")} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label={t("b.timezone")}>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <SectionTitle>{t("b.location")}</SectionTitle>
      <div className="flex gap-2">
        <Input value={query} placeholder={t("b.search_address")} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <Button variant="secondary" full={false} aria-label={t("c.search")} onClick={search} className="w-[52px] shrink-0 px-0">
          <Search size={20} />
        </Button>
      </div>
      {results && (
        <Card padded={false} className="mt-2 overflow-hidden">
          {results.length === 0 && <p className="p-4 text-hint">{t("b.search_none")}</p>}
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon}`}
              type="button"
              className="block min-h-[48px] w-full border-b border-sep px-4 py-2 text-left text-[15px] last:border-0 active:bg-sep"
              onClick={() => {
                setLat(Number(r.lat));
                setLng(Number(r.lon));
                setAccuracy(null);
                setResults(null);
              }}
            >
              {r.display_name}
            </button>
          ))}
        </Card>
      )}
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-[300px] w-full rounded-[20px]" />}>
          <MapPicker
            lat={lat}
            lng={lng}
            radiusM={radius}
            onPick={(a, b) => {
              setLat(a);
              setLng(b);
              setAccuracy(null);
            }}
          />
        </Suspense>
      </div>
      <p className="mt-2 px-1 text-[14px] text-hint">{t("b.map_hint")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="soft" full={false} loading={locating} icon={<LocateFixed size={20} />} onClick={useMine}>
          {t("b.use_my_location")}
        </Button>
        {accuracy !== null && (
          <span className={`text-[15px] font-medium ${accuracy <= 30 ? "text-ok" : "text-late"}`}>{t("b.accuracy", { n: accuracy })}</span>
        )}
      </div>

      <SectionTitle>{t("b.geofence")}</SectionTitle>
      <Card className="flex flex-col gap-4">
        <Field label={`${t("b.radius")}, m`}>
          <Stepper value={radius} step={5} min={10} max={1000} onChange={setRadius} />
        </Field>
        <Field label={`${t("b.diameter")}, m`}>
          <Stepper value={radius * 2} step={10} min={20} max={2000} onChange={(d) => setRadius(Math.round(d / 2))} />
        </Field>
      </Card>

      <BottomSpacer />
      <BottomActions text={t("c.save")} loading={busy} disabled={!name.trim() || lat === null} onClick={save} />
    </Page>
  );
}
