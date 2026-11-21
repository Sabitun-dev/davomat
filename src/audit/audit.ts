// Audit log: who changed what, when, before and after (spec 6.3).

import { db, Prisma, type Tx } from "../lib/db.ts";

type Json = Prisma.InputJsonValue | null;

/** Makes a value safe for a JSON column (BigInt and Date become strings). */
export function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Json;
}

export async function audit(
  tx: Tx | ReturnType<typeof db>,
  entry: {
    companyId: number | null;
    actorUserId: number | null;
    action: string;
    entity: string;
    entityId: string | number;
    before?: unknown;
    after?: unknown;
    comment?: string;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      companyId: entry.companyId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entity: entry.entity,
      entityId: String(entry.entityId),
      before: toJson(entry.before) ?? undefined,
      after: toJson(entry.after) ?? undefined,
      comment: entry.comment ?? "",
    },
  });
}
