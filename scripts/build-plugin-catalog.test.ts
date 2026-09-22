import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPluginCatalog,
  defaultPluginCatalogPaths,
  loadPluginCatalog,
  validatePlugin,
} from "./build-plugin-catalog";

const paths = defaultPluginCatalogPaths();

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("plugin catalog source", () => {
  it("loads fourteen listings in catalog order", async () => {
    const { spec, plugins } = await loadPluginCatalog(paths.sourceRoot);
    expect(spec.catalogVersion).toBe("v1");
    expect(plugins.map((plugin) => plugin.slug)).toEqual(spec.order);
    expect(plugins).toHaveLength(14);
  });

  it("matches the checked-in outputs byte for byte, without touching the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-plugin-catalog-test-"));
    temporaryRoots.push(root);
    const generated = {
      sourceRoot: paths.sourceRoot,
      rendererPath: join(root, "marketplace-plugin-catalog.ts"),
      workerPath: join(root, "plugin-catalog.generated.ts"),
      snapshotDir: join(root, "snapshot"),
    };
    await buildPluginCatalog({ paths: generated });
    await expect(readFile(generated.rendererPath, "utf8")).resolves.toBe(await readFile(paths.rendererPath, "utf8"));
    await expect(readFile(generated.workerPath, "utf8")).resolves.toBe(await readFile(paths.workerPath, "utf8"));
    // A stale detail file from a removed plugin must fail here rather than
    // survive beside the fresh outputs, so the file sets are compared too.
    const fresh = (await listFiles(generated.snapshotDir)).sort();
    const checkedIn = (await listFiles(paths.snapshotDir)).sort();
    expect(checkedIn).toEqual(fresh);
    for (const file of fresh) {
      await expect(readFile(join(generated.snapshotDir, file), "utf8")).resolves.toBe(
        await readFile(join(paths.snapshotDir, file), "utf8"),
      );
    }
  });

  it("passes --check on the checked-in tree", async () => {
    await expect(buildPluginCatalog({ check: true })).resolves.toMatchObject({ plugins: 14 });
  });
});

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else files.push(child);
  }
  return files;
}

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

  /* OpenBot signs in for itself and adds the header when it hands the server over, which it can
     only do for an http server. A stdio listing asking for a sign-in is asking for a bridge. */
  it("refuses a sign-in flow on a server it cannot sign in to", () => {
    const stdioSignIn = pluginWithServer({
      name: "example",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      auth: [{ id: "oauth", kind: "link", label: "Sign in" }],
    });
    expect(() => validatePlugin("example", stdioSignIn, false, updatedAt)).toThrow("sign-in needs an http server");
  });
});
