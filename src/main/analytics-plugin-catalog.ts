import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isReservedMcpServerName, type McpServerConfig } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { analyticsIO, analyticsSync } from "./analytics-effects";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export interface CatalogPluginServer {
  slug: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string[];
  setupSteps: string[];
}

export const loadCatalogPluginServers = Effect.fn("Analytics.loadPluginCatalog")(
  function* (root: string) {
    const contents = yield* analyticsIO(() => readFile(join(root, "catalog.json"), "utf8"));
    const catalog = yield* analyticsSync(() => JSON.parse(contents));
    if (!isDynamicRecord(catalog) || !Array.isArray(catalog.plugins)) return [];
    const servers = yield* Effect.forEach(
      catalog.plugins,
      Effect.fn("Analytics.loadPluginDetail")(function* (entry: unknown) {
        if (!isDynamicRecord(entry) || !isString(entry.slug) || !isString(entry.version)) return [];
        const { slug, version } = entry;
        if (!SLUG_PATTERN.test(slug) || !/^[\w.-]+$/u.test(version)) return [];
        const contents = yield* analyticsIO(() => readFile(join(root, slug, `${version}.json`), "utf8"));
        const detail = yield* analyticsSync(() => JSON.parse(contents));
        return isDynamicRecord(detail) && Array.isArray(detail.apps)
          ? detail.apps.flatMap((app: unknown) => catalogServer(slug, app))
          : [];
      }),
      { concurrency: "unbounded" },
    );
    return servers.flat();
  },
  Effect.catch(() => Effect.succeed([])),
);

function catalogServer(slug: string, app: unknown): CatalogPluginServer[] {
  if (!isDynamicRecord(app) || !isDynamicRecord(app.server)) return [];
  const { name, transport, url, command, args, auth } = app.server;
  if (!isString(name) || (transport !== "http" && transport !== "stdio")) return [];
  return [
    {
      slug,
      name,
      transport,
      url: isString(url) ? url : "",
      command: isString(command) ? command : "",
      args: Array.isArray(args) ? args.filter(isString) : [],
      setupSteps: Array.isArray(auth) ? auth.flatMap(localSetupSteps) : [],
    },
  ];
}

function localSetupSteps(flow: unknown): string[] {
  if (!isDynamicRecord(flow) || flow.kind !== "local" || !Array.isArray(flow.steps)) return [];
  return flow.steps.filter(isString);
}

export function isReportedMcpServerName(configured: string, reported: string): boolean {
  const form = (name: string) => name.replace(/[^A-Za-z0-9_-]/gu, "_").toLowerCase();
  return (
    configured === reported ||
    form(configured) === form(reported) ||
    (!isReservedMcpServerName(reported) && `openbot_${form(configured)}` === form(reported))
  );
}

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
