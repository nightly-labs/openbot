import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** The server one catalog plugin installs, as the bundled plugin catalog states it. */
export interface CatalogPluginServer {
  slug: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string[];
}

/**
 * Reads the plugin catalog that ships in the app resources. A missing or damaged catalog gives no
 * servers, so every configured server reports as `custom`: analytics must never stop startup.
 */
export async function loadCatalogPluginServers(root: string): Promise<CatalogPluginServer[]> {
  try {
    const catalog = JSON.parse(await readFile(join(root, "catalog.json"), "utf8"));
    if (!isDynamicRecord(catalog) || !Array.isArray(catalog.plugins)) return [];
    const servers = await Promise.all(
      catalog.plugins.map(async (entry: unknown) => {
        if (!isDynamicRecord(entry) || !isString(entry.slug) || !isString(entry.version)) return [];
        const { slug, version } = entry;
        if (!SLUG_PATTERN.test(slug) || !/^[\w.-]+$/u.test(version)) return [];
        const detail = JSON.parse(await readFile(join(root, slug, `${version}.json`), "utf8"));
        return isDynamicRecord(detail) && Array.isArray(detail.apps)
          ? detail.apps.flatMap((app: unknown) => catalogServer(slug, app))
          : [];
      }),
    );
    return servers.flat();
  } catch {
    return [];
  }
}

function catalogServer(slug: string, app: unknown): CatalogPluginServer[] {
  if (!isDynamicRecord(app) || !isDynamicRecord(app.server)) return [];
  const { name, transport, url, command, args } = app.server;
  if (!isString(name) || (transport !== "http" && transport !== "stdio")) return [];
  return [
    {
      slug,
      name,
      transport,
      url: isString(url) ? url : "",
      command: isString(command) ? command : "",
      args: Array.isArray(args) ? args.filter(isString) : [],
    },
  ];
}

/**
 * The catalog slug of a configured server, or `null` for the user's own server. Like the listing's
 * own matcher, the name alone is not enough: a server the user named `github` that points elsewhere
 * is theirs. An http address matches exactly, or by an https host that is the listing's host or
 * below it, because some listings ask for the user's own link on that host.
 */
export function catalogPluginSlug(
  config: McpServerConfig,
  servers: readonly CatalogPluginServer[],
  homeDirectory: string,
): string | null {
  for (const server of servers) {
    if (config.name !== server.name || config.transport !== server.transport) continue;
    if (
      server.transport === "http"
        ? isListingAddress(config.url, server.url)
        : isListingCommand(config, server, homeDirectory)
    ) {
      return server.slug;
    }
  }
  return null;
}

function isListingAddress(configured: string, listed: string): boolean {
  if (configured === listed) return true;
  try {
    const url = new URL(configured);
    const listing = new URL(listed);
    return (
      url.protocol === "https:" &&
      listing.protocol === "https:" &&
      (url.hostname === listing.hostname || url.hostname.endsWith(`.${listing.hostname}`))
    );
  } catch {
    return false;
  }
}

function isListingCommand(config: McpServerConfig, server: CatalogPluginServer, homeDirectory: string): boolean {
  const command = server.command.startsWith("~/") ? join(homeDirectory, server.command.slice(2)) : server.command;
  return (
    (config.command === server.command || config.command === command) &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
}
