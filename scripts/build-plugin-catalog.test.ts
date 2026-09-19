import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPluginCatalog,
  defaultPluginCatalogPaths,
  loadPluginCatalog,
  validatePlugin,
} from "./build-plugin-catalog";

const paths = defaultPluginCatalogPaths();

describe("plugin catalog source", () => {
  it("loads fourteen listings in catalog order", async () => {
    const { spec, plugins } = await loadPluginCatalog(paths.sourceRoot);
    expect(spec.catalogVersion).toBe("v1");
    expect(plugins.map((plugin) => plugin.slug)).toEqual(spec.order);
    expect(plugins).toHaveLength(14);
  });

  it("regenerates byte-identical outputs", async () => {
    const renderer = await readFile(paths.rendererPath, "utf8");
    const worker = await readFile(paths.workerPath, "utf8");
    const catalog = await readFile(join(paths.snapshotDir, "catalog.json"), "utf8");
    await buildPluginCatalog();
    await expect(readFile(paths.rendererPath, "utf8")).resolves.toBe(renderer);
    await expect(readFile(paths.workerPath, "utf8")).resolves.toBe(worker);
    await expect(readFile(join(paths.snapshotDir, "catalog.json"), "utf8")).resolves.toBe(catalog);
  });

  it("passes --check on the checked-in tree", async () => {
    await expect(buildPluginCatalog({ check: true })).resolves.toMatchObject({ plugins: 14 });
  });
});

interface TestAuthField {
  id: string;
  label: string;
  header?: string;
  env?: string;
  value?: string;
}

interface TestServer {
  name: string;
  transport: string;
  url?: string;
  command?: string;
  args?: string[];
  auth?: Array<{
    id: string;
    kind: string;
    label: string;
    fields?: TestAuthField[];
    docsUrl?: string;
  }>;
}

interface TestApp {
  id: string;
  name: string;
  description: string;
  iconUrl: null;
  server: TestServer;
}

interface TestPlugin {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  iconUrl: null;
  version: string;
  prompts: Array<{ id: string; text: string }>;
  apps: TestApp[];
  skills: never[];
  websiteUrl: string;
  privacyPolicyUrl: null;
  termsUrl: null;
}

const baseApp = { id: "app-example", name: "Example", description: "Example app.", iconUrl: null };

const basePlugin: Omit<TestPlugin, "apps"> = {
  slug: "example",
  name: "Example",
  tagline: "Example tagline",
  description: "Example description.",
  category: "coding",
  creatorName: "example.com",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "p1", text: "What can you do?" }],
  skills: [],
  websiteUrl: "https://example.com",
  privacyPolicyUrl: null,
  termsUrl: null,
};

function pluginWithServer(server: TestServer): TestPlugin {
  return { ...basePlugin, apps: [{ ...baseApp, iconUrl: null, server }] };
}

const httpServer: TestServer = { name: "example", transport: "http", url: "https://example.com/mcp" };

const updatedAt = "2026-09-19T00:00:00.000Z";

describe("plugin catalog validation", () => {
  it("refuses a secret-looking value", () => {
    const tainted = pluginWithServer({
      ...httpServer,
      url: "https://example.com/mcp?token=ghp_abcdefghijklmnop",
    });
    expect(() => validatePlugin("example", tainted, false, updatedAt)).toThrow("secret-looking");
  });

  it("refuses a credential value field", () => {
    const tainted = pluginWithServer({
      ...httpServer,
      auth: [
        {
          id: "key",
          kind: "key",
          label: "Key",
          fields: [{ id: "token", label: "Token", header: "Authorization", value: "typed" }],
        },
      ],
    });
    expect(() => validatePlugin("example", tainted, false, updatedAt)).toThrow("credential value");
  });

  it("refuses a reserved server name", () => {
    const reserved = pluginWithServer({ ...httpServer, name: "openbot" });
    expect(() => validatePlugin("example", reserved, false, updatedAt)).toThrow("OpenBot already uses the name");
  });

  it("refuses a second app", () => {
    const second = {
      ...basePlugin,
      apps: [
        { ...baseApp, server: httpServer },
        { ...baseApp, server: httpServer },
      ],
    };
    expect(() => validatePlugin("example", second, false, updatedAt)).toThrow("exactly one app");
  });

  it("refuses a sign-in flow outside the bridge command", () => {
    const wrongBridge = pluginWithServer({
      name: "example",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      auth: [{ id: "oauth", kind: "link", label: "Sign in" }],
    });
    expect(() => validatePlugin("example", wrongBridge, false, updatedAt)).toThrow("sign-in bridge");
  });
});
