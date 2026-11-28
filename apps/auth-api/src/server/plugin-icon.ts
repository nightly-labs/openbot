import { Effect, Result, Schema } from "effect";

class PluginIconError extends Schema.TaggedError<PluginIconError>()("PluginIconError", {}) {}

import { findPlugin } from "../lib/plugins";

const ICON_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";

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
          headers: { Accept: "image/*", "User-Agent": "OpenBot/1.0 (+https://openbot.run)" },
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
      "Content-Type": contentType,
      "Cache-Control": ICON_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});
