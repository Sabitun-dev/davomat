import { useEffect, useState } from "react";
import { moneyToInput, parseMoneyInput, type Currency } from "@shared/money.ts";
import { Input } from "./Field.tsx";

/** Money field: shows "250000" or "97.50"; reports the stored integer (or null when empty). */
export function MoneyInput({
  value,
  currency,
  onChange,
  placeholder,
}: {
  value: number | null;
  currency: Currency;
  onChange: (v: number | null, valid: boolean) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(moneyToInput(value, currency));
  useEffect(() => {
    if (parseMoneyInput(text, currency) !== value) setText(moneyToInput(value, currency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency]);
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? (currency === "USD" ? "100.00" : "250000")}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseMoneyInput(e.target.value, currency);
          onChange(parsed, e.target.value.trim() === "" || parsed !== null);
        }}
        className="pr-16"
      />
      <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[15px] text-hint">
        {currency === "USD" ? "$" : "so'm"}
      </span>
    </div>
  );
}
