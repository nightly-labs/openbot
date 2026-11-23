function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

const APP_ROUTES = new Set(["/", "/index.html", "/helper.html"]);

export function describeTarget(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "(unparseable target)";
  }
  if (!isLoopbackHost(parsed.hostname)) return `${parsed.protocol}//${parsed.hostname} (external)`;
  const surface = parsed.searchParams.get("surface") === null ? "" : " [surface]";
  if (APP_ROUTES.has(parsed.pathname)) return `${parsed.origin}${parsed.pathname}${surface}`;
  return `${parsed.origin}/… (path hidden)${surface}`;
}

export function isMainAppUrl(url: string, expectedRendererPort: number | null = null): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!isLoopbackHost(parsed.hostname)) return false;
  if (parsed.searchParams.has("surface")) return false;
  if (expectedRendererPort !== null && parsed.port !== String(expectedRendererPort)) return false;
  return parsed.pathname === "/" || parsed.pathname === "/index.html";
}

export function findMainPages<T extends { url: () => string }>(
  pages: T[],
  expectedRendererPort: number | null = null,
): T[] {
  return pages.filter((candidate) => isMainAppUrl(candidate.url(), expectedRendererPort));
}
