import { createRoot } from "react-dom/client";
import "./styles.css";
import { initTelegram, setChromeColors } from "./telegram/tg.ts";
import { App } from "./App.tsx";

function applyTheme(scheme: "light" | "dark") {
  document.documentElement.dataset.theme = scheme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim();
  if (/^#[0-9a-f]{6}$/i.test(bg)) setChromeColors(bg);
}

async function start() {
  // The screenshot review build swaps the server for demo data. Never part of the real build.
  if (import.meta.env.VITE_MOCK === "1") await import("./dev/mock.ts").then((m) => m.installMock());
  initTelegram(applyTheme);
  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
