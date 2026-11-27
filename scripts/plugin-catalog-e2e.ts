import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import {
  decodePluginCatalog,
  PLUGIN_CATALOG_PATH,
  type PluginCatalog,
  pluginsForHost,
  withBundledPlugins,
} from "@openbot/contracts/plugin-catalog";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { PLUGIN_CATALOG_CAPABILITY } from "@openbot/contracts/team-protocol/plugin-catalog-v1";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { runTeamEffect } from "@openbot/team-client";
import { createMarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import { Effect } from "effect";
import { createPluginCatalogResponder, pluginCatalogResponse } from "../apps/auth-api/src/lib/plugin-catalog-response";
import { catalogPluginSlug, loadCatalogPluginServers } from "../src/main/analytics-plugin-catalog";
import { PluginCatalogService } from "../src/main/plugin-catalog-service";
import { buildPluginCatalog, defaultPluginCatalogPaths } from "./build-plugin-catalog";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "plugin-catalog-e2e");
const BUNDLED_SNAPSHOT = join(ROOT, "resources", "plugin-catalog");
const HTTP_SLUG = "e2e-remote-http";
const STDIO_SLUG = "e2e-remote-stdio";
const STDIO_COMMAND = { command: "npx", args: ["-y", "@openbot-e2e/remote-mcp@1.0.0"] };

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];

async function check(name: string, run: () => Promise<unknown> | unknown): Promise<void> {
  try {
    const detail = await run();
    checks.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
  } catch (error) {
    checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

type PluginSourceServer =
  | { name: string; transport: "http"; url: string }
  | { name: string; transport: "stdio"; command: string; args: string[] };

interface PluginSourceFile {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  iconUrl: null;
  version: string;
  prompts: { id: string; text: string }[];
  apps: { id: string; name: string; description: string; iconUrl: null; server: PluginSourceServer }[];
  skills: [];
  websiteUrl: string;
  privacyPolicyUrl: null;
  termsUrl: null;
}

function pluginSource(slug: string, server: PluginSourceServer): PluginSourceFile {
  return {
    slug,
    name: `E2E ${slug}`,
    tagline: "Added after the release",
    description: "A plugin that the catalog adds after the client release.",
    category: "productivity",
    creatorName: "OpenBot",
    iconUrl: null,
    version: "1.0.0",
    prompts: [{ id: "prompt-try", text: "Try the new app." }],
    apps: [{ id: `app-${slug}`, name: `E2E ${slug}`, description: "The new app.", iconUrl: null, server }],
    skills: [],
    websiteUrl: "https://openbot.run",
    privacyPolicyUrl: null,
    termsUrl: null,
  };
}

async function catalogWithNewPlugins(work: string) {
  const defaults = defaultPluginCatalogPaths(ROOT);
  const sourceRoot = join(work, "source");
  await cp(defaults.sourceRoot, sourceRoot, { recursive: true });
  const added = {
    [HTTP_SLUG]: pluginSource(HTTP_SLUG, {
      name: "e2e_remote_http",
      transport: "http",
      url: "https://mcp.example.com/mcp",
    }),
    [STDIO_SLUG]: pluginSource(STDIO_SLUG, { name: "e2e_remote_stdio", transport: "stdio", ...STDIO_COMMAND }),
  };
  for (const [slug, plugin] of Object.entries(added)) {
    await mkdir(join(sourceRoot, "plugins", slug), { recursive: true });
    await writeFile(join(sourceRoot, "plugins", slug, "plugin.json"), `${JSON.stringify(plugin, null, 2)}\n`);
  }
  const specPath = join(sourceRoot, "catalog.json");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  spec.order.push(HTTP_SLUG, STDIO_SLUG);
  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const paths = {
    sourceRoot,
    rendererPath: join(work, "renderer.ts"),
    workerPath: join(work, "worker.ts"),
    mobilePath: join(work, "mobile.ts"),
    snapshotDir: join(work, "snapshot"),
  };
  await buildPluginCatalog({ paths });
  return import(paths.workerPath);
}

function stdioConfig(): McpServerConfig {
  return {
    id: "mcp-e2e",
    name: "e2e_remote_stdio",
    transport: "stdio",
    enabled: true,
    ...STDIO_COMMAND,
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

function slugs(catalog: PluginCatalog): string[] {
  return catalog.plugins.map((plugin) => plugin.slug);
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "openbot-plugin-catalog-e2e-"));
  const bundledServers = await Effect.runPromise(loadCatalogPluginServers(BUNDLED_SNAPSHOT));
  const bundledSlugs = new Set(bundledServers.map((server) => server.slug));
  const bundledIndex = JSON.parse(await readFile(join(BUNDLED_SNAPSHOT, "catalog.json"), "utf8"));
  const worker = await catalogWithNewPlugins(work);
  const respond = createPluginCatalogResponder(worker.PLUGIN_CATALOG_INDEX, worker.PLUGIN_CATALOG_DETAILS);
  let futureFormat = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      if (new URL(request.url).pathname !== PLUGIN_CATALOG_PATH) return new Response(null, { status: 404 });
      const response = respond(request);
      if (!futureFormat || response.status !== 200) return response;
      const body = await response.json();
      const future = structuredClone(body.plugins[0]);
      future.slug = "e2e-future-flow";
      future.apps[0].server.auth = [{ id: "future", kind: "passkey", label: "Use a passkey" }];
      return Response.json({ ...body, plugins: [...body.plugins, future] });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  const accountFetch: typeof fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => fetch(new URL(String(input), base), init),
    { preconnect: fetch.preconnect },
  );
  try {
    await check("the released Worker catalog decodes with no dropped entry", async () => {
      const response = pluginCatalogResponse(new Request(`https://openbot.run${PLUGIN_CATALOG_PATH}`));
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("ETag"));
      const catalog = decodePluginCatalog(await response.json());
      assert.equal(catalog.plugins.length, bundledIndex.plugins.length);
      return { plugins: catalog.plugins.length, etag: response.headers.get("ETag") };
    });

    let etag = "";
    await check("the Worker serves the new apps without a client release", async () => {
      const response = await fetch(`${base}${PLUGIN_CATALOG_PATH}`);
      assert.equal(response.status, 200);
      etag = response.headers.get("ETag") ?? "";
      const catalog = decodePluginCatalog(await response.json());
      assert.ok(slugs(catalog).includes(HTTP_SLUG));
      assert.ok(slugs(catalog).includes(STDIO_SLUG));
      assert.equal(catalog.plugins.length, bundledIndex.plugins.length + 2);
      return { plugins: catalog.plugins.length, etag };
    });

    await check("a request with the current ETag, strong or weak, gets 304", async () => {
      const response = await fetch(`${base}${PLUGIN_CATALOG_PATH}`, { headers: { "If-None-Match": etag } });
      assert.equal(response.status, 304);
      const weak = await fetch(`${base}${PLUGIN_CATALOG_PATH}`, { headers: { "If-None-Match": `"other", W/${etag}` } });
      assert.equal(weak.status, 304);
    });

    await check("the shared mobile and web client reads the new apps", async () => {
      const catalog = await runTeamEffect(createMarketplaceCatalog(accountFetch).plugins.catalog());
      assert.ok(slugs(catalog).includes(HTTP_SLUG));
      assert.ok(slugs(catalog).includes(STDIO_SLUG));
    });

    await check("an old host shows only new http apps; a host that loads the catalog shows all", async () => {
      const catalog = await runTeamEffect(createMarketplaceCatalog(accountFetch).plugins.catalog());
      const oldHost = pluginsForHost(catalog.plugins, bundledSlugs, false).map((plugin) => plugin.slug);
      const newHost = pluginsForHost(catalog.plugins, bundledSlugs, true).map((plugin) => plugin.slug);
      assert.ok(oldHost.includes(HTTP_SLUG));
      assert.ok(!oldHost.includes(STDIO_SLUG));
      assert.ok(newHost.includes(STDIO_SLUG));
      assert.ok([...bundledSlugs].every((slug) => oldHost.includes(slug)));
      return { oldHost: oldHost.length, newHost: newHost.length };
    });

    await check("a protocol 10 host announces that it loads the catalog; protocol 9 peers do not see it", () => {
      assert.ok(teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).includes(PLUGIN_CATALOG_CAPABILITY));
      assert.ok(!teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).includes(PLUGIN_CATALOG_CAPABILITY));
    });

    await check("the host recognizes a new stdio app after it loads the catalog", async () => {
      const host = new PluginCatalogService({ bundled: bundledServers, resolveApiUrl: (path) => `${base}${path}` });
      assert.equal(catalogPluginSlug(stdioConfig(), host.servers(), tmpdir()), null);
      const catalog = await Effect.runPromise(host.load());
      assert.ok(catalog);
      assert.ok(host.loaded());
      assert.equal(catalogPluginSlug(stdioConfig(), host.servers(), tmpdir()), STDIO_SLUG);
      assert.ok([...bundledSlugs].every((slug) => host.servers().some((entry) => entry.slug === slug)));
    });

    await check("the host keeps the bundled catalog when the account service is unreachable", async () => {
      const host = new PluginCatalogService({
        bundled: bundledServers,
        resolveApiUrl: (path) => `http://127.0.0.1:9${path}`,
      });
      assert.equal(await Effect.runPromise(host.load()), null);
      assert.equal(host.loaded(), false);
      assert.equal(host.servers().length, bundledServers.length);
    });

    await check(
      "a client drops only an entry that it cannot read and keeps its bundled entry for that slug",
      async () => {
        futureFormat = true;
        const response = await fetch(`${base}${PLUGIN_CATALOG_PATH}`);
        const raw = await response.json();
        const catalog = decodePluginCatalog(raw);
        futureFormat = false;
        assert.equal(raw.plugins.length, catalog.plugins.length + 1);
        assert.ok(!slugs(catalog).includes("e2e-future-flow"));
        const changedSlug = bundledIndex.plugins[0].slug;
        const changed = decodePluginCatalog({
          ...raw,
          plugins: raw.plugins.map((plugin: { slug: string }) =>
            plugin.slug === changedSlug ? { ...plugin, category: "future-category" } : plugin,
          ),
        });
        assert.ok(!slugs(changed).includes(changedSlug));
        const kept = withBundledPlugins(changed.plugins, bundledIndex.plugins);
        assert.ok(kept.some((plugin) => plugin.slug === changedSlug));
      },
    );
  } finally {
    server.stop(true);
    await rm(work, { recursive: true, force: true });
  }
  const report = { passed: checks.every((entry) => entry.passed), checks };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
