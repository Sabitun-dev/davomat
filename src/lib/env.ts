// Environment variables. Read lazily so tests can set them, and never logged.

function read(name: string): string {
  return (process.env[name] ?? "").trim();
}

function required(name: string): string {
  const v = read(name);
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  get botToken() {
    return required("BOT_TOKEN");
  },
  get webhookSecret() {
    return required("WEBHOOK_SECRET");
  },
  get setupSecret() {
    return required("SETUP_SECRET");
  },
  get qrSecret() {
    return required("QR_SIGNING_SECRET");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get groupChatId(): bigint | null {
    const v = read("GROUP_CHAT_ID");
    return /^-?\d+$/.test(v) ? BigInt(v) : null;
  },
  get ownerTelegramIds(): bigint[] {
    return read("OWNER_TELEGRAM_IDS")
      .split(/[,\s]+/)
      .filter((s) => /^\d+$/.test(s))
      .map((s) => BigInt(s));
  },
  get defaultLanguage(): "uz" | "ru" | "en" {
    const v = read("DEFAULT_LANGUAGE");
    return v === "ru" || v === "en" ? v : "uz";
  },
  get defaultTimezone() {
    return read("DEFAULT_TIMEZONE") || "Asia/Tashkent";
  },
  get botUsername() {
    return read("BOT_USERNAME").replace(/^@/, "");
  },
  get miniAppShortName() {
    return read("MINIAPP_SHORT_NAME") || "app";
  },
  /** Public site address, without a trailing slash. Netlify sets URL. */
  get appUrl() {
    return (read("APP_URL") || read("URL") || "http://localhost:8888").replace(/\/+$/, "");
  },
};

/** Removes secrets from any text before it is logged or shown. */
export function redact(text: string): string {
  let out = text;
  for (const name of ["BOT_TOKEN", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "WEBHOOK_SECRET", "SETUP_SECRET", "QR_SIGNING_SECRET"]) {
    const v = read(name);
    if (v.length >= 6) out = out.split(v).join(`[${name}]`);
  }
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot[BOT_TOKEN]").replace(/postgres(ql)?:\/\/[^\s"']+/g, "[DATABASE_URL]");
}

export function logError(context: string, err: unknown): void {
  const text = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
  console.error(`[${context}] ${redact(text)}`);
}
