import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isSkillCategory,
  type McpServerConfig,
  mcpConfigErrors,
  normalizeMcpConfig,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("build-plugin-catalog");

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "..");

const slugPattern = /^[a-z0-9][a-z0-9-]{0,62}$/u;
/**
 * The sign-in bridge runs a third-party program on the user's machine. `@latest` would make every
 * launch a fresh, unreviewed download that no release can be audited against, so the catalog names
 * one version and moves it only in a reviewed commit.
 */
const secretPattern =
  /(ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-(?:live|test|proj)-[A-Za-z0-9]{8,}|xox[bpas]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|phx_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{8,})/u;

export interface PluginCatalogPaths {
  sourceRoot: string;
  rendererPath: string;
  workerPath: string;
  snapshotDir: string;
}

export function defaultPluginCatalogPaths(root: string = projectRoot): PluginCatalogPaths {
  return {
    sourceRoot: join(root, "marketplace", "plugin-catalog"),
    rendererPath: join(root, "src", "renderer", "src", "features", "settings", "marketplace-plugin-catalog.ts"),
    workerPath: join(root, "apps", "auth-api", "src", "lib", "plugin-catalog.generated.ts"),
    snapshotDir: join(root, "resources", "plugin-catalog"),
  };
}

interface PluginCatalogSpec {
  schemaVersion: number;
  catalogVersion: string;
  updatedAt: string;
  order: string[];
  featured: string[];
}

export interface PluginPrompt {
  id: string;
  text: string;
}

export interface PluginAuthField {
  id: string;
  label: string;
  url?: boolean;
  header?: string;
  env?: string;
  prefix?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

export interface PluginLinkFlow {
  id: string;
  kind: "link";
  label: string;
}

export interface PluginKeyFlow {
  id: string;
  kind: "key";
  label: string;
  fields: PluginAuthField[];
  docsUrl?: string | null;
  docsLabel?: string;
}

export type PluginAuthFlow = PluginLinkFlow | PluginKeyFlow;

export interface PluginHttpServer {
  name: string;
  transport: "http";
  url: string;
  auth?: PluginAuthFlow[];
}

export interface PluginStdioServer {
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  auth?: PluginAuthFlow[];
}

export type PluginServer = PluginHttpServer | PluginStdioServer;

export interface PluginApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: PluginServer;
}

export interface PluginDetail {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  creatorName: string;
  iconUrl: string | null;
  version: string;
  prompts: PluginPrompt[];
  apps: PluginApp[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  featured: boolean;
  updatedAt: string;
}

/**
 * Reads the catalog source, validates every listing, and writes the three
 * generated outputs: the renderer literal the Plugins tab reads, the Worker
 * module the JSON routes will serve, and the offline snapshot shipped with
 * the app. With `check`, it fails when a checked-in file differs from a
 * fresh build, so a hand edit cannot ship.
 */
export async function buildPluginCatalog(options?: {
  check?: boolean;
  paths?: PluginCatalogPaths;
}): Promise<{ plugins: number; catalogVersion: string }> {
  const paths = options?.paths ?? defaultPluginCatalogPaths();
  const { spec, plugins } = await loadPluginCatalog(paths.sourceRoot);
  const renderer = renderRendererModule(plugins);
  const worker = renderWorkerModule(spec, plugins);
  const snapshot = renderSnapshot(spec, plugins);
  if (options?.check) {
    await checkGenerated(paths, renderer, worker, snapshot);
    return { plugins: plugins.length, catalogVersion: spec.catalogVersion };
  }
  await writeFile(paths.rendererPath, renderer);
  await writeFile(paths.workerPath, worker);
  await writeSnapshot(paths.snapshotDir, snapshot);
  return { plugins: plugins.length, catalogVersion: spec.catalogVersion };
}

export async function loadPluginCatalog(
  sourceRoot: string,
): Promise<{ spec: PluginCatalogSpec; plugins: PluginDetail[] }> {
  const spec = parseCatalogSpec(JSON.parse(await readFile(join(sourceRoot, "catalog.json"), "utf8")));
  const entries = await readdir(join(sourceRoot, "plugins"), { withFileTypes: true });
  const slugs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const unknown = slugs.filter((slug) => !spec.order.includes(slug));
  if (unknown.length > 0)
    throw new Error(`Plugin catalog has directories outside catalog.json order: ${unknown.join(", ")}.`);
  const missing = spec.order.filter((slug) => !slugs.includes(slug));
  if (missing.length > 0) throw new Error(`Plugin catalog order lists missing directories: ${missing.join(", ")}.`);
  const plugins: PluginDetail[] = [];
  for (const slug of spec.order) {
    const raw = JSON.parse(await readFile(join(sourceRoot, "plugins", slug, "plugin.json"), "utf8"));
    plugins.push(validatePlugin(slug, raw, spec.featured.includes(slug), spec.updatedAt));
  }
  return { spec, plugins };
}

function parseCatalogSpec(value: unknown): PluginCatalogSpec {
  if (!isDynamicRecord(value) || value.schemaVersion !== 1 || !isString(value.catalogVersion)) {
    throw new Error("Plugin catalog metadata is invalid.");
  }
  if (!isString(value.updatedAt) || Number.isNaN(Date.parse(value.updatedAt))) {
    throw new Error("Plugin catalog needs an updatedAt timestamp.");
  }
  if (
    !Array.isArray(value.order) ||
    !value.order.every((slug): slug is string => isString(slug) && slugPattern.test(slug))
  ) {
    throw new Error("Plugin catalog order must list valid slugs.");
  }
  if (
    !Array.isArray(value.featured) ||
    !value.featured.every((slug): slug is string => isString(slug) && slugPattern.test(slug))
  ) {
    throw new Error("Plugin catalog featured must list valid slugs.");
  }
  const order = [...value.order];
  if (new Set(order).size !== order.length) throw new Error("Plugin catalog order has a duplicate slug.");
  for (const slug of value.featured) {
    if (!order.includes(slug)) throw new Error(`Plugin catalog features an unknown slug: ${slug}.`);
  }
  return {
    schemaVersion: 1,
    catalogVersion: value.catalogVersion,
    updatedAt: value.updatedAt,
    order,
    featured: [...value.featured],
  };
}

/**
 * Validates one listing and answers the detail the generated outputs carry.
 * A secret value is never catalog data: the source must name where a
 * credential goes and must never hold one.
 */
export function validatePlugin(slug: string, value: unknown, featured: boolean, updatedAt: string): PluginDetail {
  if (!isDynamicRecord(value)) throw new Error(`Plugin ${slug} is invalid.`);
  if (value.slug !== slug) throw new Error(`Plugin ${slug} names itself ${String(value.slug)}.`);
  const text = (field: string): string => {
    const candidate = value[field];
    if (!isString(candidate) || candidate.trim().length === 0) throw new Error(`Plugin ${slug} needs ${field}.`);
    return candidate;
  };
  const link = (field: string): string | null => {
    const candidate = value[field];
    if (candidate !== null && !isHttpsUrl(candidate)) throw new Error(`Plugin ${slug} needs an https ${field}.`);
    return candidate;
  };
  if (!isSkillCategory(value.category)) throw new Error(`Plugin ${slug} has an unknown category.`);
  if (!Array.isArray(value.prompts) || value.prompts.length === 0 || value.prompts.length > 8) {
    throw new Error(`Plugin ${slug} needs one to eight prompts.`);
  }
  const prompts = value.prompts.map((prompt) => parsePrompt(slug, prompt));
  if (!Array.isArray(value.apps) || value.apps.length !== 1) {
    throw new Error(`Plugin ${slug} must carry exactly one app.`);
  }
  if (!Array.isArray(value.skills) || value.skills.length !== 0) {
    throw new Error(`Plugin ${slug} must list no skills until pinned versions exist.`);
  }
  const serialized = JSON.stringify(value);
  if (secretPattern.test(serialized)) throw new Error(`Plugin ${slug} holds a secret-looking value.`);
  if (/"value"\s*:/u.test(serialized)) throw new Error(`Plugin ${slug} must not carry a credential value.`);
  return {
    slug,
    name: text("name"),
    tagline: text("tagline"),
    description: text("description"),
    category: value.category,
    creatorName: text("creatorName"),
    iconUrl: link("iconUrl"),
    version: text("version"),
    prompts,
    apps: [parseApp(slug, value.apps[0])],
    websiteUrl: link("websiteUrl"),
    privacyPolicyUrl: link("privacyPolicyUrl"),
    termsUrl: link("termsUrl"),
    featured,
    updatedAt,
  };
}

function parsePrompt(slug: string, value: unknown): PluginPrompt {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.text) || !value.id || !value.text) {
    throw new Error(`Plugin ${slug} has an invalid prompt.`);
  }
  return { id: value.id, text: value.text };
}

function parseApp(slug: string, value: unknown): PluginApp {
  if (!isDynamicRecord(value)) throw new Error(`Plugin ${slug} has an invalid app.`);
  const text = (field: string): string => {
    const candidate = value[field];
    if (!isString(candidate) || candidate.trim().length === 0) {
      throw new Error(`Plugin ${slug} app needs ${field}.`);
    }
    return candidate;
  };
  const iconUrl = value.iconUrl;
  if (iconUrl !== null && !isHttpsUrl(iconUrl)) throw new Error(`Plugin ${slug} app needs an https iconUrl.`);
  const server = parseServer(slug, value.server);
  const base = baseServerConfig(server);
  const errors = mcpConfigErrors(normalizeMcpConfig(base));
  const firstError = errors.name ?? errors.command ?? errors.url;
  if (firstError) throw new Error(`Plugin ${slug} server is invalid: ${firstError}`);
  checkCredentialFlows(slug, server, base);
  return { id: text("id"), name: text("name"), description: text("description"), iconUrl, server };
}

function parseServer(slug: string, value: unknown): PluginServer {
  if (!isDynamicRecord(value)) throw new Error(`Plugin ${slug} app needs a server.`);
  if (!isString(value.name) || value.name.trim().length === 0) throw new Error(`Plugin ${slug} server needs a name.`);
  const auth = parseAuth(slug, value.auth, value.transport);
  if (value.transport === "http") {
    if (!isString(value.url) || !value.url.startsWith("https://")) {
      throw new Error(`Plugin ${slug} server needs an https url.`);
    }
    return auth
      ? { name: value.name, transport: "http", url: value.url, auth }
      : { name: value.name, transport: "http", url: value.url };
  }
  if (value.transport === "stdio") {
    if (!isString(value.command) || value.command.trim().length === 0 || !Array.isArray(value.args)) {
      throw new Error(`Plugin ${slug} server needs a command and args.`);
    }
    const args = value.args.every(isString) ? [...value.args] : [];
    return auth
      ? { name: value.name, transport: "stdio", command: value.command, args, auth }
      : { name: value.name, transport: "stdio", command: value.command, args };
  }
  throw new Error(`Plugin ${slug} server needs a known transport.`);
}

function parseAuth(slug: string, value: unknown, transport: unknown): PluginAuthFlow[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`Plugin ${slug} auth must be a list of flows.`);
  return value.map((flow) => parseFlow(slug, flow, transport));
}

function parseFlow(slug: string, value: unknown, transport: unknown): PluginAuthFlow {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.label) || !value.id || !value.label) {
    throw new Error(`Plugin ${slug} has an invalid auth flow.`);
  }
  if (value.kind === "link") {
    // OpenBot holds the OAuth client itself and adds the header at hand-off, which it can only do
    // for an http server. A stdio listing asking for a sign-in would be asking for a bridge program.
    if (transport !== "http") throw new Error(`Plugin ${slug} sign-in needs an http server.`);
    return { id: value.id, kind: "link", label: value.label };
  }
  if (value.kind !== "key" || !Array.isArray(value.fields) || value.fields.length === 0 || value.fields.length > 2) {
    throw new Error(`Plugin ${slug} has an invalid auth flow.`);
  }
  const fields = value.fields.map((field) => parseField(slug, field, transport));
  if (fields.filter((field) => field.url).length > 1) throw new Error(`Plugin ${slug} asks for more than one link.`);
  if (fields.every((field) => field.optional)) throw new Error(`Plugin ${slug} auth needs a required field.`);
  const docsUrl = value.docsUrl;
  if (docsUrl !== undefined && docsUrl !== null && !isHttpsUrl(docsUrl)) {
    throw new Error(`Plugin ${slug} auth needs an https docsUrl.`);
  }
  const docsLabel = value.docsLabel;
  if (docsLabel !== undefined && !isString(docsLabel)) throw new Error(`Plugin ${slug} has an invalid auth flow.`);
  return {
    id: value.id,
    kind: "key",
    label: value.label,
    fields,
    ...(docsUrl ? { docsUrl } : {}),
    ...(isString(docsLabel) ? { docsLabel } : {}),
  };
}

function parseField(slug: string, value: unknown, transport: unknown): PluginAuthField {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.label) || !value.id || !value.label) {
    throw new Error(`Plugin ${slug} has an invalid auth field.`);
  }
  const field: PluginAuthField = { id: value.id, label: value.label };
  if (value.url === true) {
    // The user's own link replaces the listing's address, which only a remote server has.
    if (transport !== "http") throw new Error(`Plugin ${slug} link field needs an http server.`);
    field.url = true;
  } else if (transport === "stdio") {
    if (!isString(value.env) || !value.env) throw new Error(`Plugin ${slug} stdio field needs an env name.`);
    field.env = value.env;
  } else {
    if (!isString(value.header) || !value.header) throw new Error(`Plugin ${slug} http field needs a header name.`);
    field.header = value.header;
  }
  for (const optional of ["prefix", "placeholder", "hint"] as const) {
    const candidate = value[optional];
    if (candidate !== undefined) {
      if (!isString(candidate)) throw new Error(`Plugin ${slug} has an invalid auth field.`);
      field[optional] = candidate;
    }
  }
  if (value.optional !== undefined) {
    if (typeof value.optional !== "boolean") throw new Error(`Plugin ${slug} has an invalid auth field.`);
    if (value.optional) field.optional = true;
  }
  return field;
}

function baseServerConfig(server: PluginServer): McpServerConfig {
  if (server.transport === "http") {
    return {
      id: "",
      name: server.name,
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: server.url,
      headers: [],
    };
  }
  return {
    id: "",
    name: server.name,
    transport: "stdio",
    enabled: true,
    command: server.command,
    args: [...server.args],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
}

/**
 * Every key flow must still validate with a typed value in place, so the
 * listing cannot declare a credential the settings form then refuses.
 */
function checkCredentialFlows(slug: string, server: PluginServer, base: McpServerConfig): void {
  for (const flow of server.auth ?? []) {
    if (flow.kind !== "key") continue;
    const applied: McpServerConfig =
      server.transport === "stdio"
        ? { ...base, env: flow.fields.map((field) => ({ key: field.env ?? "", value: `sample${field.prefix ?? ""}` })) }
        : {
            ...base,
            headers: flow.fields
              .filter((field) => !field.url)
              .map((field) => ({ key: field.header ?? "", value: `sample${field.prefix ?? ""}` })),
          };
    const errors = mcpConfigErrors(normalizeMcpConfig(applied));
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) throw new Error(`Plugin ${slug} credential is invalid: ${firstError}`);
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (!isString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Renders a value the way the formatter prints a literal: short collections
 * stay on one line, longer ones break (with trailing commas in TypeScript),
 * and string values that exceed the line width start on the next line.
 * The catalog schema only holds plain JSON values, so this printer only
 * handles those.
 */
function tsLiteral(value: unknown): string {
  return printLiteral(value, "", "ts");
}

/** The snapshot files are JSON, so keys stay quoted and commas stay absent. */
function jsonLiteral(value: unknown): string {
  return `${printLiteral(value, "", "json")}\n`;
}

type LiteralMode = "ts" | "json";

function printLiteral(value: unknown, indent: string, mode: LiteralMode, prefixWidth = 0): string {
  const flat = inlineLiteral(value, mode);
  if (indent.length + prefixWidth + flat.length <= 120) return flat;
  const closer = mode === "ts" ? ",\n" : "\n";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const child = `${indent}  `;
    return `[\n${value.map((item) => `${child}${printLiteral(item, child, mode)}`).join(",\n")}${closer}${indent}]`;
  }
  if (isDynamicRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const child = `${indent}  `;
    return `{\n${entries.map(([key, item]) => printLiteralField(key, item, child, mode)).join(",\n")}${closer}${indent}}`;
  }
  return flat;
}

function printLiteralField(key: string, value: unknown, indent: string, mode: LiteralMode): string {
  const name = mode === "ts" ? tsKey(key) : JSON.stringify(key);
  const flat = inlineLiteral(value, mode);
  const head = `${indent}${name}: ${flat}`;
  if (head.length + 1 <= 120) return head;
  if (typeof value === "string" && mode === "ts") return `${indent}${name}:\n${indent}  ${flat}`;
  if (typeof value === "string") return head;
  return `${indent}${name}: ${printLiteral(value, indent, mode, name.length + 2)}`;
}

function inlineLiteral(value: unknown, mode: LiteralMode): string {
  if (Array.isArray(value)) return `[${value.map((item) => inlineLiteral(item, mode)).join(", ")}]`;
  if (isDynamicRecord(value)) {
    const pair = (key: string, item: unknown): string => {
      const name = mode === "ts" ? tsKey(key) : JSON.stringify(key);
      return `${name}: ${inlineLiteral(item, mode)}`;
    };
    const inner = Object.entries(value).map(([key, item]) => pair(key, item));
    return `{ ${inner.join(", ")} }`;
  }
  return JSON.stringify(value) ?? "null";
}

function tsKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : JSON.stringify(key);
}

function constName(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
}

function renderRendererModule(plugins: PluginDetail[]): string {
  const blocks = plugins.map((plugin) => {
    const { featured: _featured, updatedAt: _updatedAt, ...detail } = plugin;
    return `const ${constName(plugin.slug)}: MarketplacePluginDetail = ${tsLiteral({
      id: `plugin-${plugin.slug}`,
      ...detail,
      skills: [],
      installs: 0,
      featured: plugin.featured,
      updatedAt: plugin.updatedAt,
      shareUrl: `https://openbot.run/plugins/${plugin.slug}`,
    })};`;
  });
  const list = plugins.map((plugin) => constName(plugin.slug)).join(",\n  ");
  return `/**
 * The plugins the marketplace offers.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand: run bun run marketplace:build:plugins, or
 * bun run marketplace:build:plugins -- --check to verify.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { MarketplacePluginApp, MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";

/**
 * The configuration an app installs as. The catalog states the name and how the server is reached -
 * an address, or a command and its words; the rest of the record and \`enabled\` are made here rather
 * than stored as catalog data that could disagree with \`normalizeMcpConfig\`.
 *
 * A credential is never among them. What a server asks for is declared in \`server.auth\`, and the
 * value is typed by the user in the connect dialog, which hands back the configuration that
 * connected.
 *
 * The id is empty, which is what the store reads as "new". An id it does not hold is an edit of a
 * row that is gone, and the save is refused.
 */
export function createPluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

${blocks.join("\n\n")}

export const MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [
  ${list},
];
`;
}

function renderWorkerModule(spec: PluginCatalogSpec, plugins: PluginDetail[]): string {
  const details: Record<string, Omit<PluginDetail, "featured" | "updatedAt"> & { skills: never[] }> = {};
  for (const plugin of plugins) {
    const { featured: _featured, updatedAt: _updatedAt, ...detail } = plugin;
    details[plugin.slug] = { ...detail, skills: [] };
  }
  const index = {
    schemaVersion: spec.schemaVersion,
    catalogVersion: spec.catalogVersion,
    updatedAt: spec.updatedAt,
    plugins: plugins.map((plugin) => ({
      slug: plugin.slug,
      version: plugin.version,
      featured: spec.featured.includes(plugin.slug),
      detailSha256: sha256(jsonLiteral(details[plugin.slug])),
    })),
  };
  return `/**
 * Plugin catalog served by the Account Worker.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand.
 */

export interface PluginCatalogIndex {
  schemaVersion: number;
  catalogVersion: string;
  /** When the catalog last changed. The public site dates its listing pages by it. */
  updatedAt: string;
  plugins: Array<{ slug: string; version: string; featured: boolean; detailSha256: string }>;
}

export const PLUGIN_CATALOG_INDEX: PluginCatalogIndex = ${tsLiteral(index)};

export interface PluginCatalogPrompt {
  id: string;
  text: string;
}

export interface PluginCatalogApp {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  server: PluginCatalogServer;
}

export type PluginCatalogServer =
  | { name: string; transport: "http"; url: string; auth?: unknown }
  | { name: string; transport: "stdio"; command: string; args: string[]; auth?: unknown };

export interface PluginCatalogDetail {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  iconUrl: string | null;
  version: string;
  prompts: PluginCatalogPrompt[];
  apps: PluginCatalogApp[];
  skills: unknown[];
  websiteUrl: string | null;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}

export const PLUGIN_CATALOG_DETAILS: Record<string, PluginCatalogDetail> = ${tsLiteral(details)};
`;
}

function renderSnapshot(spec: PluginCatalogSpec, plugins: PluginDetail[]): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const details: Record<string, Omit<PluginDetail, "featured" | "updatedAt"> & { skills: never[] }> = {};
  for (const plugin of plugins) {
    const { featured: _featured, updatedAt: _updatedAt, ...detail } = plugin;
    details[plugin.slug] = { ...detail, skills: [] };
    files.push({ path: `${plugin.slug}/${plugin.version}.json`, content: jsonLiteral(details[plugin.slug]) });
  }
  files.push({
    path: "catalog.json",
    content: jsonLiteral({
      schemaVersion: spec.schemaVersion,
      catalogVersion: spec.catalogVersion,
      plugins: plugins.map((plugin) => ({
        slug: plugin.slug,
        version: plugin.version,
        featured: spec.featured.includes(plugin.slug),
        detailSha256: sha256(jsonLiteral(details[plugin.slug])),
      })),
    }),
  });
  return files;
}

async function writeSnapshot(dir: string, files: Array<{ path: string; content: string }>): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  for (const file of files) {
    const target = join(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function checkGenerated(
  paths: PluginCatalogPaths,
  renderer: string,
  worker: string,
  snapshot: Array<{ path: string; content: string }>,
): Promise<void> {
  const expected = new Map<string, string>();
  expected.set(resolve(paths.rendererPath), renderer);
  expected.set(resolve(paths.workerPath), worker);
  for (const file of snapshot) expected.set(resolve(join(paths.snapshotDir, file.path)), file.content);
  const actual = new Map<string, string>();
  actual.set(resolve(paths.rendererPath), await readFile(paths.rendererPath, "utf8"));
  actual.set(resolve(paths.workerPath), await readFile(paths.workerPath, "utf8"));
  for (const file of snapshot) {
    actual.set(resolve(join(paths.snapshotDir, file.path)), await readFile(join(paths.snapshotDir, file.path), "utf8"));
  }
  const mismatched = [...expected.keys()].filter((path) => expected.get(path) !== actual.get(path));
  if (mismatched.length > 0) {
    const relative = mismatched.map((path) =>
      path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path,
    );
    throw new Error(
      `Generated plugin catalog is stale: ${relative.join(", ")}. Run bun run marketplace:build:plugins.`,
    );
  }
}

function parseArguments(args: string[]): { check: boolean } {
  if (args.includes("--help")) {
    process.stdout.write("Usage: bun scripts/build-plugin-catalog.ts [-- --check]\n");
    process.exit(0);
  }
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === "--check") return { check: true };
  throw new Error("Usage: bun scripts/build-plugin-catalog.ts [-- --check]");
}

if (import.meta.main) {
  buildPluginCatalog(parseArguments(process.argv.slice(2)))
    .then((summary) =>
      process.stdout.write(`Built plugin catalog ${summary.catalogVersion} with ${summary.plugins} plugins.\n`),
    )
    .catch((error) => {
      logger.error("Plugin catalog generation failed.", toLogValue(error));
      process.exitCode = 1;
    });
}
