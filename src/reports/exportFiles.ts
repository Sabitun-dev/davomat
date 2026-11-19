// Signed export links: the server signed who asked and what, so the file is rebuilt with
// that admin's permissions (still checked) without a login header.

import { db } from "../lib/db.ts";
import { notFound } from "../lib/errors.ts";
import { loadActor } from "../users/service.ts";
import { isStaff } from "../auth/permissions.ts";
import { buildExport, type ExportFile, type ExportFormat, type ExportKind } from "./exports.ts";

export async function exportFileFromParams(params: Record<string, string>): Promise<ExportFile> {
  const user = await db().user.findUnique({ where: { id: Number(params.u) } });
  if (!user) throw notFound();
  const actor = await loadActor(user);
  if (!isStaff(actor)) throw notFound();
  return buildExport(actor, params.k as ExportKind, params.f as ExportFormat, params.m, params.b ? Number(params.b) : undefined, user.language);
}
