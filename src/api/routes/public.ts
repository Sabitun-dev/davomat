// Routes without Telegram login: the tablet display page and signed file downloads.

import { Hono } from "hono";
import { ROTATE_WINDOW_SEC, rotatingToken } from "../../attendance/qr.ts";
import { branchQrText, fileSlug, posterPdf, qrPng, qrSvg } from "../../branches/qrFiles.ts";
import { deviceByKey } from "../../branches/service.ts";
import { miniAppLink } from "../../lib/appConfig.ts";
import { db } from "../../lib/db.ts";
import { env } from "../../lib/env.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { verifySignedUrl } from "../../lib/signedUrl.ts";
import type { AppEnv } from "../context.ts";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/display", async (c) => {
  const device = await deviceByKey(c.req.query("d") ?? "");
  if (!device) throw new AppError("display_invalid", 404);
  const now = Date.now();
  const token = rotatingToken(env.qrSecret, device.branchId, device.branch.qrVersion, now);
  const secondsLeft = ROTATE_WINDOW_SEC - (Math.floor(now / 1000) % ROTATE_WINDOW_SEC);
  c.header("cache-control", "no-store");
  return c.json({
    branchName: device.branch.name,
    svg: await qrSvg(await miniAppLink(token)),
    secondsLeft,
    rotating: device.branch.qrMode === "ROTATING",
  });
});

function file(data: Uint8Array, type: string, name: string): Response {
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": type,
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}

publicRoutes.get("/files/:name", async (c) => {
  const name = c.req.param("name");
  const params = verifySignedUrl(name, new URL(c.req.url).searchParams);
  if (!params) throw notFound();
  if (name === "qr.png" || name === "poster.pdf") {
    const branch = await db().branch.findUnique({ where: { id: Number(params.b) } });
    if (!branch || String(branch.qrVersion) !== params.v) throw notFound();
    const text = await branchQrText(branch);
    const slug = fileSlug(branch.name);
    return name === "qr.png"
      ? file(await qrPng(text), "image/png", `${slug}-qr.png`)
      : file(await posterPdf(branch, text), "application/pdf", `${slug}-poster.pdf`);
  }
  throw notFound();
});
