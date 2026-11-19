import { defineConfig } from "prisma/config";

// Load a local .env when it exists (Netlify provides real environment variables instead).
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

// Migrations need Neon's direct (unpooled) connection; the app itself uses DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    url:
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.DATABASE_URL ||
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
