// Serves /api/*. All logic lives in src/; this file only hands the request over.
import type { Config } from "@netlify/functions";
import { app } from "../../src/api/app.ts";

export default (req: Request) => app.fetch(req);

export const config: Config = { path: "/api/*" };
