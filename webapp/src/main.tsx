import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import "./styles.css";
import { initTelegram, setChromeColors } from "./telegram/tg.ts";
import { I18nProvider, toLang } from "./i18n/index.tsx";
import { App } from "./App.tsx";

const Display = lazy(() => import("./screens/Display.tsx"));

function applyTheme(scheme: "light" | "dark") {
  document.documentElement.dataset.theme = scheme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim();
  if (/^#[0-9a-f]{6}$/i.test(bg)) setChromeColors(bg);
}

async function start() {
  // The screenshot review build swaps the server for demo data. Never part of the real build.
  if (import.meta.env.VITE_MOCK === "1") await import("./dev/mock.ts").then((m) => m.installMock());
  initTelegram(applyTheme);
  const root = createRoot(document.getElementById("root")!);
  if (location.pathname.startsWith("/app/display")) {
    // The branch tablet: a plain browser page, no Telegram.
    root.render(
      <I18nProvider lang={toLang(new URLSearchParams(location.search).get("lang") ?? navigator.language)}>
        <Suspense fallback={null}>
          <Display />
        </Suspense>
      </I18nProvider>,
    );
  } else root.render(<App />);
}

void start();
