// /api/platform/* — only for platform owners (checked by requirePlatform in app.ts).

import { Hono } from "hono";
import {
  addCompanyOwner,
  companyDetail,
  createCompany,
  extendCompany,
  listCompanies,
  setCompanyActive,
  updateCompany,
} from "../../platform/service.ts";
import { body, intParam, type AppEnv } from "../context.ts";

export const platformRoutes = new Hono<AppEnv>();

platformRoutes.get("/companies", async (c) => c.json(await listCompanies()));
platformRoutes.post("/companies", async (c) => c.json(await createCompany(c.get("actor"), await body(c))));
platformRoutes.get("/companies/:id", async (c) => c.json(await companyDetail(intParam(c.req.param("id")))));
platformRoutes.patch("/companies/:id", async (c) =>
  c.json(await updateCompany(c.get("actor"), intParam(c.req.param("id")), await body(c))),
);
platformRoutes.post("/companies/:id/extend", async (c) => {
  const b = await body<{ months?: number }>(c);
  return c.json(await extendCompany(c.get("actor"), intParam(c.req.param("id")), b.months));
});
platformRoutes.post("/companies/:id/active", async (c) => {
  const b = await body<{ active?: boolean }>(c);
  return c.json(await setCompanyActive(c.get("actor"), intParam(c.req.param("id")), b.active));
});
platformRoutes.post("/companies/:id/owners", async (c) => {
  const b = await body<{ telegramId?: string }>(c);
  return c.json(await addCompanyOwner(c.get("actor"), intParam(c.req.param("id")), b.telegramId));
});
