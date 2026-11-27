import { SKILL_CATEGORY_LABELS } from "@openbot/contracts/ipc-skills";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { MARKETPLACE_APPS_ROUTE } from "./marketplace-routes";
import { PLUGIN_CATALOG_DETAILS, PLUGIN_CATALOG_INDEX, type PluginCatalogDetail } from "./plugin-catalog.generated";
import { OPENBOT_SITE_URL, type PageSocialImage } from "./site-metadata";

export interface SitePlugin extends PluginCatalogDetail {
  featured: boolean;
  shareUrl: string;
}

export interface SitePluginSkill {
  slug: string;
  description: string;
}

const PLUGIN_INDEX_ROUTE = "/plugins";
export const PLUGIN_DETAIL_ROUTE = "/plugins/$slug";

export const PLUGINS_DESCRIPTION =
  "Apps and skills an OpenBot agent can use. Open a plugin in the app, and decide there what it connects to.";
export const PLUGIN_PAGE_SOCIAL_IMAGE: PageSocialImage = {
  path: "/social/plugin.jpg",
  alt: "Plant an idea. Your agents do the rest. OpenBot agents among paper trees",
};

export const SITE_PLUGINS: readonly SitePlugin[] = PLUGIN_CATALOG_INDEX.plugins.flatMap((entry) => {
  const detail = PLUGIN_CATALOG_DETAILS[entry.slug];
  return detail ? [{ ...detail, featured: entry.featured, shareUrl: createPluginShareUrl(entry.slug) }] : [];
});

export const PLUGINS_UPDATED_AT = PLUGIN_CATALOG_INDEX.updatedAt;

export function findPlugin(slug: string): SitePlugin | null {
  return SITE_PLUGINS.find((plugin) => plugin.slug === slug) ?? null;
}

export function pluginCategoryLabel(category: string): string {
  const labels: Record<string, string> = SKILL_CATEGORY_LABELS;
  return labels[category] ?? category;
}

export function pluginSkills(plugin: SitePlugin): SitePluginSkill[] {
  return plugin.skills.flatMap((skill) =>
    typeof skill === "object" &&
    skill !== null &&
    "slug" in skill &&
    typeof skill.slug === "string" &&
    "description" in skill &&
    typeof skill.description === "string"
      ? [{ slug: skill.slug, description: skill.description }]
      : [],
  );
}

interface SitePluginKeyField {
  label: string;
  hint: string | null;
  optional: boolean;
}

export type SitePluginConnectStep =
  | { kind: "link"; app: string }
  | { kind: "key"; app: string; fields: SitePluginKeyField[]; docsUrl: string | null; docsLabel: string | null }
  | {
      kind: "local";
      app: string;
      label: string;
      steps: string[];
      note: string | null;
      docsUrl: string | null;
      docsLabel: string | null;
    };

function readString(record: DynamicRecord, key: string): string | null {
  const value = record[key];
  return isString(value) && value.trim() ? value : null;
}

function readKeyFields(entry: DynamicRecord): SitePluginKeyField[] {
  const fields = entry.fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    if (!isDynamicRecord(field)) return [];
    const label = readString(field, "label");
    return label ? [{ label, hint: readString(field, "hint"), optional: field.optional === true }] : [];
  });
}

function readConnectStep(app: string, entry: unknown): SitePluginConnectStep[] {
  if (!isDynamicRecord(entry)) return [];
  const kind = readString(entry, "kind");
  const docsUrl = pluginExternalHref(readString(entry, "docsUrl"));
  const docsLabel = readString(entry, "docsLabel");
  if (kind === "link") return [{ kind, app }];
  if (kind === "key") {
    const fields = readKeyFields(entry);
    return fields.length > 0 ? [{ kind, app, fields, docsUrl, docsLabel }] : [];
  }
  const label = readString(entry, "label");
  if (kind === "local" && label) {
    const steps = Array.isArray(entry.steps) ? entry.steps.filter(isString) : [];
    return [{ kind, app, label, steps, note: readString(entry, "note"), docsUrl, docsLabel }];
  }
  return [];
}

export interface SitePluginMcpServer {
  app: string;
  where: string;
  address: string;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

function isLoopbackUrl(address: string): boolean {
  return URL.canParse(address) && LOOPBACK_HOSTS.includes(new URL(address).hostname);
}

export function pluginMcpServers(plugin: SitePlugin): SitePluginMcpServer[] {
  return plugin.apps.map((app) =>
    app.server.transport === "http"
      ? {
          app: app.name,
          where: isLoopbackUrl(app.server.url)
            ? "local MCP server on the computer that runs OpenBot, at"
            : "remote MCP server at",
          address: app.server.url,
        }
      : {
          app: app.name,
          where: "local MCP server that starts on the computer that runs OpenBot with",
          address: [app.server.command, ...app.server.args].join(" "),
        },
  );
}

export function pluginMcpIntro(plugin: SitePlugin): string {
  const servers = plugin.apps.length === 1 ? "this MCP server" : `these ${plugin.apps.length} MCP servers`;
  return `The ${plugin.name} plugin is the OpenBot connector for ${plugin.name}. It gives your agents the tools of ${servers}:`;
}

export function pluginConnectSteps(plugin: SitePlugin): SitePluginConnectStep[] {
  return plugin.apps.flatMap((app) => {
    const auth = app.server.auth;
    return Array.isArray(auth) ? auth.flatMap((entry) => readConnectStep(app.name, entry)) : [];
  });
}

export function pluginPath(slug: string): string {
  return `${PLUGIN_INDEX_ROUTE}/${slug}`;
}

export function pluginIconPath(slug: string, appId?: string): string {
  const path = `${PLUGIN_INDEX_ROUTE}/icon/${encodeURIComponent(slug)}`;
  return appId ? `${path}?app=${encodeURIComponent(appId)}` : path;
}

export function pluginUrl(slug: string, siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(pluginPath(slug), siteUrl).toString();
}

export function pluginIndexUrl(siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(MARKETPLACE_APPS_ROUTE, siteUrl).toString();
}

export function pluginExternalHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type PluginTagGroup = "category";

export interface PluginTag {
  group: PluginTagGroup;
  label: string;
}

export function pluginTags(plugin: SitePlugin): PluginTag[] {
  return [{ group: "category", label: pluginCategoryLabel(plugin.category) }];
}

export function pluginTagFilters(plugins: readonly SitePlugin[]): PluginTag[] {
  const seen = new Map<string, PluginTag>();
  for (const plugin of plugins) {
    for (const tag of pluginTags(plugin)) {
      if (!seen.has(tag.label)) seen.set(tag.label, tag);
    }
  }
  return [...seen.values()];
}

export function matchesPluginTags(plugin: SitePlugin, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;

  const carried = new Set(pluginTags(plugin).map((tag) => tag.label));
  const asked = new Map<PluginTagGroup, string[]>();
  for (const tag of pluginTagFilters(SITE_PLUGINS)) {
    if (selected.includes(tag.label)) asked.set(tag.group, [...(asked.get(tag.group) ?? []), tag.label]);
  }

  return [...asked.values()].every((group) => group.some((label) => carried.has(label)));
}

export function pluginMonogram(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}
