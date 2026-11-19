// Applies database migrations during the Netlify build — only for the production deploy.
// Netlify sets CONTEXT to "production", "deploy-preview" or "branch-deploy". Previews and branch
// deploys must never change the production database, so they skip this step.
// Locally (no CONTEXT) it runs only when you ask for it: MIGRATE_LOCAL=1 npm run migrate
import { execSync } from "node:child_process";

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const context = process.env.CONTEXT ?? "";
if (context !== "production" && process.env.MIGRATE_LOCAL !== "1") {
  console.log(`[migrate] Skipped: this is not the production deploy (CONTEXT="${context || "local"}").`);
  process.exit(0);
}
if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL is not set. Add it in Netlify environment variables.");
  process.exit(context === "production" ? 1 : 0);
}
console.log("[migrate] Applying database migrations...");
execSync("npx prisma migrate deploy", { stdio: "inherit" });
