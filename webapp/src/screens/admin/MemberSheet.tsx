// A worker in a branch: position, default daily amount, active, move / also allow / remove.

import { useState } from "react";
import { BarChart3, Phone } from "lucide-react";
import { api, invalidate, useApi } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { useSession } from "../../session.tsx";
import { confirm, openTelegramLink } from "../../telegram/tg.ts";
import { Button, Field, Input, ListCard, ListRow, Select, Sheet, Toggle, errorText, useToast } from "../../ui/index.ts";
import { MoneyInput } from "../../ui/MoneyInput.tsx";
import type { Branch, Member } from "../../types.ts";

export function MemberSheet({
  member,
  branchId,
  onClose,
  onChanged,
}: {
  member: Member;
  branchId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const { me } = useSession();
  const branches = useApi<Branch[]>("/admin/branches");
  const [position, setPosition] = useState(member.position);
  const [amount, setAmount] = useState<number | null>(member.defaultDailyAmount);
  const [amountOk, setAmountOk] = useState(true);
  const [active, setActive] = useState(member.active);
  const [target, setTarget] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      invalidate("/admin");
      toast(t("c.saved"));
      onChanged();
    } catch (e) {
      toast(errorText(t, e), "error");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() => api(`/admin/members/${member.memberId}`, { method: "PATCH", body: { position, defaultDailyAmount: amount, active } }));
  const toBranch = (move: boolean) =>
    target !== "" && run(() => api(`/admin/members/${member.memberId}/branch`, { body: { branchId: target, move } }));
  const remove = async () => {
    if (!(await confirm(t("mem.remove_confirm")))) return;
    await run(() => api(`/admin/members/${member.memberId}`, { method: "PATCH", body: { active: false } }));
  };

  const others = (branches.data ?? []).filter((b) => b.id !== branchId && b.active);

  return (
    <Sheet open onClose={onClose} title={member.name}>
      <ListCard>
        {member.phone && (
          <ListRow
            icon={<Phone size={20} />}
            title={member.phone}
            subtitle={member.username ? `@${member.username}` : t("mem.phone")}
            onClick={member.username ? () => openTelegramLink(`https://t.me/${member.username}`) : undefined}
          />
        )}
        <ListRow
          icon={<BarChart3 size={20} />}
          title={t("mem.this_month")}
          onClick={() => {
            onClose();
            nav.push("workerReport", { userId: member.userId, name: member.name });
          }}
        />
        <ListRow
          icon={<BarChart3 size={20} />}
          title={t("mem.own_schedule")}
          onClick={() => {
            onClose();
            nav.push("schedule", { branchId, userId: member.userId, name: member.name });
          }}
        />
      </ListCard>

      <div className="mt-4 flex flex-col gap-4">
        <Field label={t("mem.position")}>
          <Input value={position} maxLength={60} placeholder={t("mem.position_ph")} onChange={(e) => setPosition(e.target.value)} />
        </Field>
        <Field label={t("mem.default_amount")} error={amountOk ? undefined : t("err.bad_amount")}>
          <MoneyInput
            value={amount}
            currency={me.company.currency}
            onChange={(v, ok) => {
              setAmount(v);
              setAmountOk(ok);
            }}
          />
        </Field>
        <ListCard>
          <Toggle checked={active} onChange={setActive} label={t("mem.active")} />
        </ListCard>
        <Button loading={busy} disabled={!amountOk} onClick={save}>
          {t("c.save")}
        </Button>
      </div>

      {others.length > 0 && (
        <div className="mt-6 flex flex-col gap-3">
          <Field label={t("mem.choose_branch")}>
            <Select value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}>
              <option value="">—</option>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" disabled={target === ""} onClick={() => toBranch(true)}>
              {t("mem.move")}
            </Button>
            <Button variant="secondary" disabled={target === ""} onClick={() => toBranch(false)}>
              {t("mem.allow")}
            </Button>
          </div>
        </div>
      )}

      {member.active && (
        <div className="mt-6">
          <Button variant="danger" onClick={remove}>
            {t("mem.remove")}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
