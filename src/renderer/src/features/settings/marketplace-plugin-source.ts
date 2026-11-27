import type { ServerSummary } from "@openbot/contracts/ipc";
import { type CatalogPlugin, type PluginCatalog, pluginsForHost } from "@openbot/contracts/plugin-catalog";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import type { MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";
import { createSignal } from "solid-js";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { MARKETPLACE_PLUGINS } from "./marketplace-plugin-catalog";

const CATALOG_LIFETIME_MS = 30 * 60 * 1000;

const BUNDLED_SLUGS: ReadonlySet<string> = new Set(MARKETPLACE_PLUGINS.map((plugin) => plugin.slug));

const [loadedPlugins, setLoadedPlugins] = createSignal<readonly MarketplacePluginDetail[] | null>(null);
let loadedAt = Number.NEGATIVE_INFINITY;
let pending: Promise<void> | null = null;

export function marketplacePlugins(): readonly MarketplacePluginDetail[] {
  return loadedPlugins() ?? MARKETPLACE_PLUGINS;
}

export function marketplacePluginsForServer(server: ServerSummary | undefined): MarketplacePluginDetail[] {
  const hostLoadsCatalog = server?.kind !== "remote" || serverSupportsCapability(server, "plugin-catalog-v1");
  return pluginsForHost(marketplacePlugins(), BUNDLED_SLUGS, hostLoadsCatalog);
}

export function loadMarketplacePlugins(read: () => Promise<PluginCatalog | null>): Promise<void> {
  if (pending) return pending;
  if (Date.now() - loadedAt < CATALOG_LIFETIME_MS) return Promise.resolve();
  pending = read()
    .then((catalog) => {
      if (!catalog || catalog.plugins.length === 0) return;
      setLoadedPlugins(catalog.plugins.map(marketplacePluginDetail));
      loadedAt = Date.now();
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}

function marketplacePluginDetail(plugin: CatalogPlugin): MarketplacePluginDetail {
  return {
    id: `plugin-${plugin.slug}`,
    slug: plugin.slug,
    name: plugin.name,
    tagline: plugin.tagline,
    description: plugin.description,
    category: plugin.category,
    creatorName: plugin.creatorName,
    iconUrl: plugin.iconUrl,
    version: plugin.version,
    prompts: plugin.prompts,
    apps: plugin.apps,
    websiteUrl: plugin.websiteUrl,
    privacyPolicyUrl: plugin.privacyPolicyUrl,
    termsUrl: plugin.termsUrl,
    skills: [],
    installs: 0,
    featured: plugin.featured,
    updatedAt: plugin.updatedAt,
    shareUrl: createPluginShareUrl(plugin.slug),
  };
}
