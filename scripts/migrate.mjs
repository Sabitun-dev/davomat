// Applies database migrations during the Netlify build.
// Skips quietly when no database is configured (for example on a local build).
import { execSync } from "node:child_process";

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
  console.log("[migrate] No DATABASE_URL set, skipping migrations.");
  process.exit(0);
}
console.log("[migrate] Applying database migrations...");
execSync("npx prisma migrate deploy", { stdio: "inherit" });
