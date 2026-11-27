import { PLUGIN_CATALOG_SCHEMA_VERSION } from "@openbot/contracts/plugin-catalog";
import {
  PLUGIN_CATALOG_DETAILS,
  PLUGIN_CATALOG_INDEX,
  type PluginCatalogDetail,
  type PluginCatalogIndex,
} from "./plugin-catalog.generated";

const CATALOG_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400";

export function createPluginCatalogResponder(
  index: PluginCatalogIndex,
  details: Readonly<Record<string, PluginCatalogDetail>>,
): (request: Request) => Response {
  const etag = `"${index.catalogSha256}"`;
  const headers = { "Cache-Control": CATALOG_CACHE_CONTROL, ETag: etag, "X-Content-Type-Options": "nosniff" };
  const body = JSON.stringify({
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogSha256: index.catalogSha256,
    updatedAt: index.updatedAt,
    plugins: index.plugins.flatMap((entry) => {
      const detail = details[entry.slug];
      if (!detail) return [];
      const { skills: _skills, ...plugin } = detail;
      return [{ ...plugin, featured: entry.featured, updatedAt: index.updatedAt }];
    }),
  });
  return (request) => {
    if (matchesEtag(request.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  };
}

function matchesEtag(header: string | null, etag: string): boolean {
  return (header ?? "").split(",").some((value) => value.trim().replace(/^W\//u, "") === etag);
}

export const pluginCatalogResponse = createPluginCatalogResponder(PLUGIN_CATALOG_INDEX, PLUGIN_CATALOG_DETAILS);
