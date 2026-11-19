import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Each database test file starts its own in-memory Postgres; keep memory low (also on Netlify).
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
