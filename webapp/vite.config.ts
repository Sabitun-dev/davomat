import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The Mini App is served from /app/ and built into public/app/ (Netlify publishes public/).
// VITE_OUT_DIR lets the screenshot review build a mock-data copy somewhere else.
export default defineConfig({
  root: here("."),
  base: "/app/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": here("../src/shared") } },
  build: {
    outDir: process.env.VITE_OUT_DIR || here("../public/app"),
    emptyOutDir: true,
    target: "es2019",
    cssTarget: "chrome61",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8888" },
  },
});
