// A thin, typed wrapper around the official telegram-web-app.js.
// Every feature is checked before use, so old Telegram versions and a normal browser still work.

type Callback<T = void> = (arg: T) => void;

interface BottomButton {
  setParams(p: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
    has_shine_effect?: boolean;
    position?: "left" | "right" | "top" | "bottom";
  }): void;
  onClick(fn: () => void): void;
  offClick(fn: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

interface LocationData {
  latitude: number;
  longitude: number;
  horizontal_accuracy: number | null;
}

interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; language_code?: string } };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  onEvent(name: string, fn: (...a: unknown[]) => void): void;
  offEvent(name: string, fn: (...a: unknown[]) => void): void;
  MainButton: BottomButton;
  SecondaryButton?: BottomButton;
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
  HapticFeedback?: {
    impactOccurred(s: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(t: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  showScanQrPopup(p: { text?: string }, cb: (text: string) => boolean | void): void;
  closeScanQrPopup(): void;
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    isAccessRequested: boolean;
    isAccessGranted: boolean;
    init(cb?: () => void): void;
    getLocation(cb: (data: LocationData | null) => void): void;
    openSettings(): void;
  };
  DeviceStorage?: {
    getItem(key: string, cb: (err: unknown, value?: string | null) => void): void;
    setItem(key: string, value: string, cb?: (err: unknown) => void): void;
  };
  CloudStorage?: {
    getItem(key: string, cb: (err: unknown, value?: string) => void): void;
    setItem(key: string, value: string, cb?: (err: unknown) => void): void;
  };
  requestContact(cb: (shared: boolean) => void): void;
  requestWriteAccess(cb: (granted: boolean) => void): void;
  downloadFile?(p: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  openTelegramLink(url: string): void;
  openLink(url: string): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: WebApp };
  }
}

export const tg: WebApp | undefined = window.Telegram?.WebApp;

/** True when the app runs inside Telegram with signed user data. */
export const inTelegram = Boolean(tg?.initData);

export function atLeast(version: string): boolean {
  return Boolean(tg && tg.isVersionAtLeast(version));
}

export function initData(): string {
  return tg?.initData ?? "";
}

export function startParam(): string | null {
  return tg?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get("startapp");
}

export function telegramLanguage(): string | undefined {
  return tg?.initDataUnsafe.user?.language_code;
}

export function colorScheme(): "light" | "dark" {
  // Outside Telegram the script still exists but always says "light".
  if (inTelegram && tg?.colorScheme) return tg.colorScheme;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initTelegram(onTheme: Callback<"light" | "dark">): void {
  if (!tg) return onTheme(colorScheme());
  tg.ready();
  tg.expand();
  if (atLeast("7.7")) tg.disableVerticalSwipes?.();
  onTheme(colorScheme());
  tg.onEvent("themeChanged", () => onTheme(colorScheme()));
}

export const haptic = {
  tap() {
    if (atLeast("6.1")) tg?.HapticFeedback?.impactOccurred("light");
  },
  select() {
    if (atLeast("6.1")) tg?.HapticFeedback?.selectionChanged();
  },
  success() {
    if (atLeast("6.1")) tg?.HapticFeedback?.notificationOccurred("success");
    else navigator.vibrate?.(30);
  },
  error() {
    if (atLeast("6.1")) tg?.HapticFeedback?.notificationOccurred("error");
    else navigator.vibrate?.([40, 60, 40]);
  },
  warning() {
    if (atLeast("6.1")) tg?.HapticFeedback?.notificationOccurred("warning");
  },
};

export function canNativeScan(): boolean {
  return Boolean(tg && atLeast("6.4") && !["unknown", "tdesktop", "macos", "web", "weba", "webk"].includes(tg.platform));
}

/** Opens Telegram's live QR scanner. Resolves with the first code, or null when closed. */
export function nativeScan(text: string, accept: (code: string) => boolean): Promise<string | null> {
  return new Promise((resolve) => {
    if (!tg) return resolve(null);
    let done = false;
    const onClose = () => {
      tg.offEvent("scanQrPopupClosed", onClose);
      if (!done) resolve(null);
    };
    tg.onEvent("scanQrPopupClosed", onClose);
    tg.showScanQrPopup({ text }, (code) => {
      if (!accept(code)) return false;
      done = true;
      tg.offEvent("scanQrPopupClosed", onClose);
      resolve(code);
      return true;
    });
  });
}

export type LocationResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reason: "denied" | "unavailable" | "timeout" };

function telegramLocation(): Promise<LocationResult | null> {
  const lm = tg?.LocationManager;
  if (!lm || !atLeast("8.0")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const get = () => {
      if (!lm.isLocationAvailable) return resolve(null);
      if (lm.isAccessRequested && !lm.isAccessGranted) return resolve({ ok: false, reason: "denied" });
      lm.getLocation((data) => {
        if (!data) return resolve(lm.isAccessGranted ? { ok: false, reason: "unavailable" } : { ok: false, reason: "denied" });
        resolve({ ok: true, lat: data.latitude, lng: data.longitude, accuracy: data.horizontal_accuracy ?? 9999 });
      });
    };
    if (lm.isInited) get();
    else lm.init(get);
  });
}

/** Browser GPS: keeps the best reading within the timeout (default 15 s). */
function browserLocation(timeoutMs: number): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ok: false, reason: "unavailable" });
    let best: GeolocationPosition | null = null;
    let finished = false;
    const finish = (r: LocationResult) => {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      resolve(r);
    };
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        // Good enough: stop waiting.
        if (pos.coords.accuracy <= 15) {
          finish({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) finish({ ok: false, reason: "denied" });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
    const timer = setTimeout(() => {
      if (best) {
        const c = best.coords;
        finish({ ok: true, lat: c.latitude, lng: c.longitude, accuracy: c.accuracy });
      } else finish({ ok: false, reason: "timeout" });
    }, timeoutMs);
  });
}

/** Telegram LocationManager first, then the browser. */
export async function getLocation(timeoutMs = 15000): Promise<LocationResult> {
  const fromTelegram = await telegramLocation();
  if (fromTelegram?.ok) {
    // Telegram gives one reading; if it is weak, try the browser for a better one.
    if (fromTelegram.accuracy <= 30) return fromTelegram;
    const fromBrowser = await browserLocation(Math.min(timeoutMs, 8000));
    if (fromBrowser.ok && fromBrowser.accuracy < fromTelegram.accuracy) return fromBrowser;
    return fromTelegram;
  }
  if (fromTelegram && !fromTelegram.ok && fromTelegram.reason === "denied") {
    const fromBrowser = await browserLocation(timeoutMs);
    return fromBrowser.ok ? fromBrowser : fromTelegram;
  }
  return browserLocation(timeoutMs);
}

export function openLocationSettings(): boolean {
  if (tg?.LocationManager && atLeast("8.0")) {
    tg.LocationManager.openSettings();
    return true;
  }
  return false;
}

/** A random id for this device, kept in Telegram DeviceStorage, CloudStorage or localStorage. */
export async function deviceId(): Promise<string> {
  const KEY = "davomat_device_id";
  const make = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const fromStorage = (s: WebApp["DeviceStorage"] | WebApp["CloudStorage"]) =>
    new Promise<string | null>((resolve) => {
      if (!s) return resolve(null);
      try {
        s.getItem(KEY, (err, value) => resolve(err ? null : (value ?? null)));
        setTimeout(() => resolve(null), 1500);
      } catch {
        resolve(null);
      }
    });
  const store = atLeast("9.0") && tg?.DeviceStorage ? tg.DeviceStorage : atLeast("6.9") ? tg?.CloudStorage : undefined;
  let id = await fromStorage(store);
  if (!id) {
    try {
      id = localStorage.getItem(KEY);
    } catch {
      id = null;
    }
  }
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    id = make();
    store?.setItem(KEY, id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // private mode
    }
  }
  return id;
}

export function requestContact(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg || !atLeast("6.9")) return resolve(false);
    tg.requestContact((shared) => resolve(shared));
  });
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg || !atLeast("6.9")) return resolve(false);
    tg.requestWriteAccess((granted) => resolve(granted));
  });
}

export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg && atLeast("6.2")) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

export function openTelegramLink(url: string): void {
  if (tg) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

export function shareLink(url: string, text: string): void {
  openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}

export function canDownloadFile(): boolean {
  return Boolean(tg?.downloadFile && atLeast("8.0"));
}

export function downloadFile(url: string, fileName: string): void {
  if (canDownloadFile()) tg!.downloadFile!({ url, file_name: fileName });
  else window.open(url, "_blank");
}

export function setChromeColors(bg: string): void {
  if (!tg) return;
  if (atLeast("6.1")) {
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
  }
  if (atLeast("7.10")) tg.setBottomBarColor?.(bg);
}
