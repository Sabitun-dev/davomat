import { createContext, useContext, useMemo, type ReactNode } from "react";
import { uz, type Key } from "./uz.ts";
import { ru } from "./ru.ts";
import { en } from "./en.ts";

export type { Key };
export type Lang = "uz" | "ru" | "en";

const dictionaries: Record<Lang, Partial<Record<Key, string>>> = { uz, ru, en };

export type T = (key: Key, params?: Record<string, string | number>) => string;

function makeT(lang: Lang): T {
  const dict = dictionaries[lang] ?? uz;
  return (key, params = {}) => {
    const template = dict[key] ?? uz[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, n: string) => (n in params ? String(params[n]) : `{${n}}`));
  };
}

const I18n = createContext<{ lang: Lang; t: T }>({ lang: "uz", t: makeT("uz") });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT(): T {
  return useContext(I18n).t;
}

export function useLang(): Lang {
  return useContext(I18n).lang;
}

export function toLang(code: string | null | undefined): Lang {
  if (code === "ru" || code === "en" || code === "uz") return code;
  if (code?.startsWith("ru")) return "ru";
  return "uz";
}

const MONTHS: Record<Lang, string[]> = {
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"],
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export function monthName(month: string, lang: Lang): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[lang][m - 1]} ${y}`;
}

export function shortMonth(m: number, lang: Lang): string {
  return MONTHS[lang][m - 1].slice(0, 3);
}

/** "2026-03-05" -> "5 Mart" */
export function dayLabel(date: string, lang: Lang): string {
  const [, m, d] = date.split("-").map(Number);
  return lang === "en" ? `${MONTHS.en[m - 1]} ${d}` : `${d} ${MONTHS[lang][m - 1].toLowerCase()}`;
}
