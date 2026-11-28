import { Effect, Result, Schema } from "effect";

class PluginIconError extends Schema.TaggedError<PluginIconError>()("PluginIconError", {}) {}

import { findPlugin } from "../lib/plugins";
import tregIcon from "../lib/treg-icon.png?inline";

const ICON_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
const ICON_HEADERS = {
  "Cache-Control": ICON_CACHE_CONTROL,
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

const notFound = () => new Response("Not found", { status: 404 });

function isServableImage(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("image/") && type !== "image/svg+xml";
}

function iconSource(slug: string, appId: string | null): string | null {
  const plugin = findPlugin(slug);
  if (!plugin) return null;
  if (appId) {
    const app = plugin.apps.find((candidate) => candidate.id === appId);
    return app?.iconUrl ?? null;
  }
  return plugin.iconUrl;
}

export const pluginIconResponse = Effect.fn("PluginIcon.response")(function* (slug: string, appId: string | null) {
  const source = iconSource(slug, appId);
  if (!source) return notFound();

  if (source === "https://openbot.run/plugins/icon/treg") {
    const base64 = tregIcon.slice(tregIcon.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return new Response(bytes, { headers: { ...ICON_HEADERS, "Content-Type": "image/png" } });
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return notFound();
  }
  if (url.protocol !== "https:") return notFound();

  const result = yield* Effect.result(
    Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: { Accept: "image/*" },
          redirect: "follow",
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        }),
      catch: () => new PluginIconError({}),
    }),
  );
  if (Result.isFailure(result)) return notFound();
  const upstream = result.success;
  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (!upstream.ok || !isServableImage(contentType)) return notFound();

  return new Response(upstream.body, {
    headers: {
      ...ICON_HEADERS,
      "Content-Type": contentType,
    },
  });
});
