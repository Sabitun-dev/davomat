// Demo server for the screenshot review build (VITE_MOCK=1). Never included in the real app.

type Handler = (url: URL, body: unknown) => unknown;

const routes: [RegExp, Handler][] = [];

export function route(pattern: RegExp, handler: Handler) {
  routes.push([pattern, handler]);
}

export async function installMock() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const path = url.pathname.slice(4);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const key = `${init?.method ?? "GET"} ${path}`;
    for (const [pattern, handler] of routes) {
      if (pattern.test(key)) {
        await new Promise((r) => setTimeout(r, 120));
        return new Response(JSON.stringify(handler(url, body)), { headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  };
  (await import("./scenarios.ts")).registerScenarios();
}
