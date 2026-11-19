// Scheduled function: every 15 minutes. The work itself is in src/jobs/scheduler.ts.
import type { Config } from "@netlify/functions";
import { runScheduler } from "../../src/jobs/scheduler.ts";

export default async () => {
  const summary = await runScheduler();
  console.log("[scheduler]", JSON.stringify(summary));
};

export const config: Config = { schedule: "*/15 * * * *" };
