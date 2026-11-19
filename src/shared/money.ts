// Money is always an integer: whole so'm (UZS) or US cents (USD).

export type Currency = "UZS" | "USD";

function groupThousands(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const UZS_WORD: Record<string, string> = { uz: "so'm", ru: "сум", en: "so'm" };

/** 4500000 UZS -> "4 500 000 so'm"; 9750 USD -> "$97.50". */
export function formatMoney(amount: number, currency: Currency, lang = "uz"): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  let text: string;
  if (currency === "USD") {
    const dollars = Math.floor(abs / 100);
    const cents = String(abs % 100).padStart(2, "0");
    text = `$${groupThousands(dollars, ",")}.${cents}`;
  } else {
    text = `${groupThousands(abs, " ")} ${UZS_WORD[lang] ?? UZS_WORD.uz}`;
  }
  return negative ? `−${text}` : text;
}

/** What an admin types ("97.50", "250 000") -> stored integer, or null if invalid. */
export function parseMoneyInput(text: string, currency: Currency): number | null {
  const clean = text.replace(/so'?m|сум|\$/gi, "").replace(/[\s ,']/g, "");
  if (clean === "") return null;
  if (currency === "USD") {
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    const [whole, frac = ""] = clean.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  }
  if (!/^\d+$/.test(clean)) return null;
  return Number(clean);
}

/** Stored integer -> the plain number shown in an input box ("97.50", "250000"). */
export function moneyToInput(amount: number | null | undefined, currency: Currency): string {
  if (amount == null) return "";
  if (currency === "USD") return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
  return String(amount);
}
