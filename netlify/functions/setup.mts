// Setup page: https://<site>/setup?key=SETUP_SECRET
import type { Config } from "@netlify/functions";
import { safeEqual } from "../../src/lib/crypto.ts";
import { env } from "../../src/lib/env.ts";
import { renderSetupPage, runSetup } from "../../src/setup/setup.ts";

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export default async (req: Request) => {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  let secret = "";
  try {
    secret = env.setupSecret;
  } catch {
    return html(renderSetupPage(null, "SETUP_SECRET is not set in Netlify environment variables."), 500);
  }
  if (!key || !safeEqual(key, secret)) return html(renderSetupPage(null, "Wrong or missing key."), 403);
  return html(renderSetupPage(await runSetup()));
};

export const config: Config = { path: "/setup" };
