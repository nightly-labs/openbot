import { MAC_AUTOMATION_TARGETS, type MacAutomationTarget } from "./ipc-app-auth";
import { isSkillCategory, type SkillCategory } from "./ipc-skills";
import type { McpAuth, McpAuthField, McpConnectFlow } from "./mcp-connect-flows";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const PLUGIN_CATALOG_PATH = "/v1/plugins/catalog";

export const PLUGIN_CATALOG_SCHEMA_VERSION = 1;

export interface CatalogPluginPrompt {
  id: string;
  text: string;
}

export type CatalogPluginServer =
  | { name: string; transport: "http"; url: string; earlierUrls?: string[]; auth?: McpAuth }
  | {
      name: string;
      transport: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
      auth?: McpAuth;
    };

export interface CatalogPluginApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: CatalogPluginServer;
  macAutomation?: MacAutomationTarget[];
}

export interface CatalogPlugin {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  iconUrl: string | null;
  version: string;
  prompts: CatalogPluginPrompt[];
  apps: CatalogPluginApp[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  featured: boolean;
  updatedAt: string;
}

export interface PluginCatalog {
  schemaVersion: typeof PLUGIN_CATALOG_SCHEMA_VERSION;
  catalogSha256: string;
  updatedAt: string;
  plugins: CatalogPlugin[];
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export function decodePluginCatalog(value: unknown): PluginCatalog {
  if (
    !isDynamicRecord(value) ||
    value.schemaVersion !== PLUGIN_CATALOG_SCHEMA_VERSION ||
    !isString(value.catalogSha256) ||
    !isString(value.updatedAt) ||
    !Array.isArray(value.plugins)
  )
    throw new Error("Invalid plugin catalog response.");
  const seen = new Set<string>();
  const plugins = value.plugins.flatMap((entry: unknown) => {
    const plugin = decodeCatalogPlugin(entry);
    if (!plugin || seen.has(plugin.slug)) return [];
    seen.add(plugin.slug);
    return [plugin];
  });
  return {
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogSha256: value.catalogSha256,
    updatedAt: value.updatedAt,
    plugins,
  };
}

export function withBundledPlugins<T extends { slug: string }>(remote: readonly T[], bundled: readonly T[]): T[] {
  const listed = new Set(remote.map((plugin) => plugin.slug));
  return [...remote, ...bundled.filter((plugin) => !listed.has(plugin.slug))];
}

export function pluginsForHost<T extends { slug: string; apps: readonly { server: { transport: string } }[] }>(
  plugins: readonly T[],
  bundled: ReadonlySet<string>,
  hostLoadsCatalog: boolean,
): T[] {
  if (hostLoadsCatalog) return [...plugins];
  return plugins.filter(
    (plugin) => bundled.has(plugin.slug) || plugin.apps.every((app) => app.server.transport === "http"),
  );
}

function decodeCatalogPlugin(value: unknown): CatalogPlugin | null {
  if (!isDynamicRecord(value) || !isString(value.slug) || !SLUG_PATTERN.test(value.slug)) return null;
  if (!isSkillCategory(value.category) || !isBoolean(value.featured)) return null;
  const name = text(value.name);
  const tagline = text(value.tagline);
  const description = text(value.description);
  const creatorName = text(value.creatorName);
  const version = text(value.version);
  const updatedAt = text(value.updatedAt);
  if (!name || !tagline || !description || !creatorName || !version || !updatedAt) return null;
  const { iconUrl, websiteUrl, privacyPolicyUrl, termsUrl } = value;
  if (!isOptionalLink(iconUrl) || !isOptionalLink(websiteUrl)) return null;
  if (!isOptionalLink(privacyPolicyUrl) || !isOptionalLink(termsUrl)) return null;
  if (!Array.isArray(value.prompts) || !Array.isArray(value.apps) || value.apps.length === 0) return null;
  const prompts = value.prompts.map(decodePrompt);
  const apps = value.apps.map(decodeApp);
  if (!prompts.every((prompt) => prompt !== null) || !apps.every((app) => app !== null)) return null;
  return {
    slug: value.slug,
    name,
    tagline,
    description,
    category: value.category,
    creatorName,
    iconUrl,
    version,
    prompts,
    apps,
    websiteUrl,
    privacyPolicyUrl,
    termsUrl,
    featured: value.featured,
    updatedAt,
  };
}

function text(value: unknown): string | null {
  return isString(value) && value.trim().length > 0 ? value : null;
}

function isOptionalLink(value: unknown): value is string | null {
  return value === null || isHttpsLink(value);
}

function isHttpsLink(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function decodePrompt(value: unknown): CatalogPluginPrompt | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.text) || !value.id || !value.text) return null;
  return { id: value.id, text: value.text };
}

function decodeApp(value: unknown): CatalogPluginApp | null {
  if (!isDynamicRecord(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  const description = text(value.description);
  const server = decodeServer(value.server);
  const { iconUrl } = value;
  if (!id || !name || !description || !server || !isOptionalLink(iconUrl)) return null;
  const app: CatalogPluginApp = { id, name, description, iconUrl, server };
  if (value.macAutomation === undefined) return app;
  if (!Array.isArray(value.macAutomation) || !value.macAutomation.every(isMacAutomationTarget)) return null;
  return { ...app, macAutomation: [...value.macAutomation] };
}

function isMacAutomationTarget(value: unknown): value is MacAutomationTarget {
  return isOneOf(MAC_AUTOMATION_TARGETS, value);
}

function decodeServer(value: unknown): CatalogPluginServer | null {
  if (!isDynamicRecord(value) || !isString(value.name) || value.name.trim().length === 0) return null;
  const auth = decodeAuth(value.auth);
  if (auth === null) return null;
  const withAuth = auth ? { auth } : {};
  if (value.transport === "http") {
    if (!isString(value.url) || !isServerUrl(value.url)) return null;
    if (value.earlierUrls === undefined) return { name: value.name, transport: "http", url: value.url, ...withAuth };
    if (!Array.isArray(value.earlierUrls) || !value.earlierUrls.every(isHttpsLink)) return null;
    return { name: value.name, transport: "http", url: value.url, earlierUrls: [...value.earlierUrls], ...withAuth };
  }
  if (value.transport !== "stdio" || !isString(value.command) || value.command.trim().length === 0) return null;
  if (!Array.isArray(value.args) || !value.args.every(isString)) return null;
  const server: CatalogPluginServer = {
    name: value.name,
    transport: "stdio",
    command: value.command,
    args: [...value.args],
    ...withAuth,
  };
  if (value.env === undefined) return server;
  const env = decodeEnv(value.env);
  return env ? { ...server, env } : null;
}

function isServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function decodeEnv(value: unknown): Record<string, string> | null {
  if (!isDynamicRecord(value)) return null;
  const env: Record<string, string> = {};
  for (const [key, setting] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || !isString(setting)) return null;
    env[key] = setting;
  }
  return env;
}

function decodeAuth(value: unknown): McpAuth | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  const flows = value.map(decodeFlow);
  return flows.every((flow) => flow !== null) ? flows : null;
}

function decodeFlow(value: unknown): McpConnectFlow | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.label) || !value.id || !value.label)
    return null;
  const base = { id: value.id, label: value.label };
  if (value.kind === "link") return { ...base, kind: "link" };
  const docs = decodeDocs(value);
  if (!docs) return null;
  if (value.kind === "local") {
    if (!Array.isArray(value.steps) || !value.steps.every(isString)) return null;
    if (value.note !== undefined && !isString(value.note)) return null;
    return {
      ...base,
      kind: "local",
      steps: [...value.steps],
      ...(isString(value.note) ? { note: value.note } : {}),
      ...docs.fields,
    };
  }
  if (value.kind !== "key" || !Array.isArray(value.fields) || value.fields.length === 0) return null;
  const fields = value.fields.map(decodeField);
  if (!fields.every((field) => field !== null)) return null;
  return { ...base, kind: "key", fields, ...docs.fields };
}

function decodeDocs(value: DynamicRecord): { fields: { docsUrl?: string | null; docsLabel?: string } } | null {
  const { docsUrl, docsLabel } = value;
  if (docsUrl !== undefined && docsUrl !== null && !isHttpsLink(docsUrl)) return null;
  if (docsLabel !== undefined && !isString(docsLabel)) return null;
  return {
    fields: {
      ...(docsUrl !== undefined ? { docsUrl } : {}),
      ...(isString(docsLabel) ? { docsLabel } : {}),
    },
  };
}

const FIELD_TEXTS = ["header", "env", "prefix", "placeholder", "hint"] as const;

function decodeField(value: unknown): McpAuthField | null {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.label) || !value.id || !value.label)
    return null;
  const field: McpAuthField = { id: value.id, label: value.label };
  for (const key of FIELD_TEXTS) {
    const text = value[key];
    if (text === undefined) continue;
    if (!isString(text)) return null;
    field[key] = text;
  }
  for (const key of ["url", "optional"] as const) {
    const flag = value[key];
    if (flag === undefined) continue;
    if (!isBoolean(flag)) return null;
    field[key] = flag;
  }
  return field;
}
