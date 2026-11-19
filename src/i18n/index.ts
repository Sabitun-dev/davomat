// Server-side texts (bot messages, exported files). The app has its own texts in webapp/src/i18n.

import { en } from "./en.ts";
import { ru } from "./ru.ts";
import { uz, type MessageKey } from "./uz.ts";

export type { MessageKey };

const dictionaries: Record<string, Record<MessageKey, string>> = { uz, ru, en };

export function t(lang: string, key: MessageKey, params: Record<string, string | number> = {}): string {
  const dict = dictionaries[lang] ?? uz;
  const template = dict[key] ?? uz[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/** Escapes user text before it goes into a Telegram HTML message. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
