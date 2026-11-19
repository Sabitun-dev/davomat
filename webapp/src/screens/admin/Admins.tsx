// Owner only: choose admins and their branches.

import { useState } from "react";
import { Shield, UserRound } from "lucide-react";
import { api, useApi } from "../../api.ts";
import { useT } from "../../i18n/index.tsx";
import { useNav } from "../../nav.tsx";
import { confirm } from "../../telegram/tg.ts";
import { Button, ErrorState, ListCard, ListRow, Page, SectionTitle, Sheet, SkeletonScreen, Toggle, errorText, useToast } from "../../ui/index.ts";
import type { Branch, Person } from "../../types.ts";

export default function AdminsScreen() {
  const t = useT();
  const nav = useNav();
  const toast = useToast();
  const people = useApi<Person[]>("/admin/people");
  const branches = useApi<Branch[]>("/admin/branches");
  const [editing, setEditing] = useState<Person | null>(null);
  const [picked, setPicked] = useState<number[]>([]);

  if (people.error) return <ErrorState error={people.error} onRetry={people.reload} />;
  if (!people.data || !branches.data) return <SkeletonScreen />;

  const staff = people.data.filter((p) => p.role !== "WORKER");
  const others = people.data.filter((p) => p.role === "WORKER");
  const branchName = (id: number) => branches.data!.find((b) => b.id === id)?.name ?? "";
  const open = (p: Person) => {
    setEditing(p);
    setPicked(p.adminBranchIds);
  };
  const save = async () => {
    try {
      await api(`/admin/admins/${editing!.userId}`, { method: "PUT", body: { branchIds: picked } });
      toast(t("c.saved"));
      setEditing(null);
      people.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    }
  };
  const remove = async () => {
    if (!(await confirm(t("adm.remove_confirm")))) return;
    try {
      await api(`/admin/admins/${editing!.userId}`, { method: "DELETE" });
      setEditing(null);
      people.reload();
    } catch (e) {
      toast(errorText(t, e), "error");
    }
  };

  return (
    <Page title={t("adm.title")} onBack={nav.pop}>
      <ListCard>
        {staff.map((p) => (
          <ListRow
            key={p.userId}
            icon={<Shield size={20} />}
            title={p.name}
            subtitle={p.role === "OWNER" ? t("role.OWNER") : p.adminBranchIds.map(branchName).join(", ") || "—"}
            onClick={p.role === "OWNER" ? undefined : () => open(p)}
          />
        ))}
      </ListCard>
      <SectionTitle>{t("adm.add")}</SectionTitle>
      <p className="mb-3 px-1 text-[14px] text-hint">{t("adm.add_hint")}</p>
      {others.length > 0 && (
        <ListCard>
          {others.map((p) => (
            <ListRow key={p.userId} icon={<UserRound size={20} />} title={p.name} subtitle={p.phone ?? undefined} onClick={() => open(p)} />
          ))}
        </ListCard>
      )}
      <Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.name}>
        <SectionTitle>{t("adm.branches")}</SectionTitle>
        <ListCard>
          {branches.data.map((b) => (
            <Toggle
              key={b.id}
              label={b.name}
              checked={picked.includes(b.id)}
              onChange={(on) => setPicked(on ? [...picked, b.id] : picked.filter((id) => id !== b.id))}
            />
          ))}
        </ListCard>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={save}>{editing?.role === "ADMIN" ? t("c.save") : t("mem.make_admin")}</Button>
          {editing?.role === "ADMIN" && (
            <Button variant="danger" onClick={remove}>
              {t("adm.remove")}
            </Button>
          )}
        </div>
      </Sheet>
    </Page>
  );
}
