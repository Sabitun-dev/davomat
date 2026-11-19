import { Hono } from "hono";
import { sendFile } from "../../bot/api.ts";
import { branchQrText, fileSlug, posterPdf, qrPng, qrSvg } from "../../branches/qrFiles.ts";
import {
  addToBranch,
  branchJson,
  createBranch,
  createDevice,
  getBranchFor,
  listBranches,
  listDevices,
  listMembers,
  regenerateQr,
  revokeDevice,
  updateBranch,
  updateMember,
} from "../../branches/service.ts";
import { createInvite, listInvites, revokeInvite } from "../../invites/service.ts";
import { t } from "../../i18n/index.ts";
import { AppError } from "../../lib/errors.ts";
import { signedUrl } from "../../lib/signedUrl.ts";
import { listPeople, removeAdmin, setAdmin } from "../../users/admins.ts";
import { body, intParam, type AppEnv } from "../context.ts";

export const branchRoutes = new Hono<AppEnv>();

branchRoutes.get("/branches", async (c) => c.json(await listBranches(c.get("actor"))));

branchRoutes.post("/branches", async (c) => {
  const branch = await createBranch(c.get("actor"), await body(c));
  return c.json(branchJson(branch));
});

branchRoutes.get("/branches/:id", async (c) => {
  const branch = await getBranchFor(c.get("actor"), intParam(c.req.param("id")));
  const text = await branchQrText(branch);
  return c.json({
    ...branchJson(branch),
    qr: {
      svg: await qrSvg(text),
      version: branch.qrVersion,
      pngUrl: signedUrl("qr.png", { b: String(branch.id), v: String(branch.qrVersion) }),
      posterUrl: signedUrl("poster.pdf", { b: String(branch.id), v: String(branch.qrVersion) }),
      fileBase: fileSlug(branch.name),
    },
  });
});

branchRoutes.patch("/branches/:id", async (c) => {
  const branch = await updateBranch(c.get("actor"), intParam(c.req.param("id")), await body(c));
  return c.json(branchJson(branch));
});

branchRoutes.post("/branches/:id/qr/regenerate", async (c) => {
  const branch = await regenerateQr(c.get("actor"), intParam(c.req.param("id")));
  return c.json(branchJson(branch));
});

/** The bot sends the PNG or the A4 poster to the admin's own chat. */
branchRoutes.post("/branches/:id/qr/send", async (c) => {
  const actor = c.get("actor");
  const user = c.get("user");
  const branch = await getBranchFor(actor, intParam(c.req.param("id")));
  const { kind } = await body<{ kind?: string }>(c);
  const text = await branchQrText(branch);
  const slug = fileSlug(branch.name);
  const result =
    kind === "poster"
      ? await sendFile(user.telegramId, await posterPdf(branch, text), `${slug}-poster.pdf`, t(user.language, "file.poster_caption", { branch: branch.name }))
      : await sendFile(user.telegramId, await qrPng(text), `${slug}-qr.png`, t(user.language, "file.qr_caption", { branch: branch.name }));
  if (result !== "ok") throw new AppError("send_failed", 400);
  return c.json({ sent: true });
});

branchRoutes.get("/branches/:id/devices", async (c) => c.json(await listDevices(c.get("actor"), intParam(c.req.param("id")))));
branchRoutes.post("/branches/:id/devices", async (c) => {
  const { name } = await body<{ name?: string }>(c);
  return c.json(await createDevice(c.get("actor"), intParam(c.req.param("id")), name));
});
branchRoutes.delete("/devices/:id", async (c) => {
  await revokeDevice(c.get("actor"), intParam(c.req.param("id")));
  return c.json({ ok: true });
});

branchRoutes.get("/branches/:id/invites", async (c) => c.json(await listInvites(c.get("actor"), intParam(c.req.param("id")))));
branchRoutes.post("/branches/:id/invites", async (c) =>
  c.json(await createInvite(c.get("actor"), intParam(c.req.param("id")), await body(c))),
);
branchRoutes.delete("/invites/:id", async (c) => {
  await revokeInvite(c.get("actor"), intParam(c.req.param("id")));
  return c.json({ ok: true });
});

branchRoutes.get("/branches/:id/members", async (c) => c.json(await listMembers(c.get("actor"), intParam(c.req.param("id")))));
branchRoutes.patch("/members/:id", async (c) => {
  await updateMember(c.get("actor"), intParam(c.req.param("id")), await body(c));
  return c.json({ ok: true });
});
branchRoutes.post("/members/:id/branch", async (c) => {
  const b = await body<{ branchId?: number; move?: boolean }>(c);
  await addToBranch(c.get("actor"), intParam(c.req.param("id")), intParam(String(b.branchId)), b.move === true);
  return c.json({ ok: true });
});

branchRoutes.get("/people", async (c) => c.json(await listPeople(c.get("actor"))));
branchRoutes.put("/admins/:userId", async (c) => {
  const { branchIds } = await body<{ branchIds?: number[] }>(c);
  await setAdmin(c.get("actor"), intParam(c.req.param("userId")), branchIds);
  return c.json({ ok: true });
});
branchRoutes.delete("/admins/:userId", async (c) => {
  await removeAdmin(c.get("actor"), intParam(c.req.param("userId")));
  return c.json({ ok: true });
});
