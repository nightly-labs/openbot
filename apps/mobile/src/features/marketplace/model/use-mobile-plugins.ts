import { type CatalogPlugin, pluginsForHost } from "@openbot/contracts/plugin-catalog";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { loadPluginCatalog } from "../api/marketplace-catalog";
import { MOBILE_PLUGINS, type MobilePlugin, type MobilePluginApp } from "./plugin-catalog.generated";

const PLUGIN_CATALOG_FRESH_MS = 30 * 60_000;

const BUNDLED_SLUGS: ReadonlySet<string> = new Set(MOBILE_PLUGINS.map((plugin) => plugin.slug));

export function useMobilePlugins(serverId: string): readonly MobilePlugin[] {
  const { session } = useMobileSession();
  const apiUrl = session?.apiUrl ?? null;
  const hostLoadsCatalog = useMobileWorkspaceSelector((workspace) => workspace.hostLoadsPluginCatalog(serverId));
  const catalog = useQuery({
    queryKey: queryKeys.marketplace(apiUrl, "plugins"),
    enabled: apiUrl !== null,
    staleTime: PLUGIN_CATALOG_FRESH_MS,
    retry: false,
    queryFn: ({ signal }) => loadPluginCatalog(apiUrl ?? "", signal),
  });
  return useMemo(() => {
    const plugins = catalog.data?.plugins;
    if (!plugins?.length) return MOBILE_PLUGINS;
    return pluginsForHost(plugins.map(mobilePlugin), BUNDLED_SLUGS, hostLoadsCatalog);
  }, [catalog.data, hostLoadsCatalog]);
}

function mobilePlugin(plugin: CatalogPlugin): MobilePlugin {
  return {
    slug: plugin.slug,
    name: plugin.name,
    tagline: plugin.tagline,
    description: plugin.description,
    category: plugin.category,
    creatorName: plugin.creatorName,
    version: plugin.version,
    prompts: plugin.prompts,
    apps: plugin.apps.map(
      ({ iconUrl: _iconUrl, macAutomation, ...app }): MobilePluginApp =>
        macAutomation?.length ? { ...app, needsMac: true } : app,
    ),
    websiteUrl: plugin.websiteUrl,
    privacyPolicyUrl: plugin.privacyPolicyUrl,
    termsUrl: plugin.termsUrl,
    featured: plugin.featured,
  };
}
