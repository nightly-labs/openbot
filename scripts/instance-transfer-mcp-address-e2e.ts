import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { unzipSync } from "fflate";
import { loadCatalogPluginServers } from "../src/main/analytics-plugin-catalog";
import { INSTANCE_TRANSFER_MANIFEST } from "../src/main/instance-transfer-manifest";
import type { InstanceTransferOptions } from "../src/main/instance-transfer-service";
import { emptyInstanceTransferService } from "./instance-transfer-e2e-fixture";

const run = Effect.runPromise;
const OUT = resolve(import.meta.dirname, "../.openbot-build/instance-transfer-mcp-address-e2e");
const SECRET = "Zk9TqW3mVb7XpL2nR8cY";
const LINEAR = "https://mcp.linear.app/mcp";
const ACCOUNT = `${LINEAR}#account-second`;

function server(name: string, url: string): McpServerConfig {
  return {
    id: name,
    name,
    transport: "http",
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url,
    headers: [{ key: "Authorization", value: `Bearer ${SECRET}` }],
    enabled: true,
  };
}

const sourceServers = [
  server("linear", LINEAR),
  server("linear-second", ACCOUNT),
  server("notes", `https://notes.example.com/mcp/s/${SECRET}`),
  server("fal", `https://mcp.fal.ai/mcp-relay/${SECRET}`),
  server("my-linear", `https://mcp.linear.app/s/${SECRET}`),
];

const report: { checks: { name: string; passed: boolean }[]; passed: boolean; error?: string } = {
  checks: [],
  passed: false,
};

function check(name: string, condition: boolean): void {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, name);
}

function sidebar() {
  return { revision: 1, sections: [], order: [], agentAssignments: {}, agentOrder: [] };
}

function settingsPort(
  servers: McpServerConfig[],
  listed: InstanceTransferOptions["settings"]["listedMcpServers"],
  saved: McpServerConfig[],
): Partial<InstanceTransferOptions["settings"]> {
  return {
    mcpServers: () => servers,
    ...(listed ? { listedMcpServers: listed } : {}),
    saveMcpServer: (config) => Effect.sync(() => saved.push(config)),
    customProviders: () => [],
    customAgents: () => Effect.succeed([]),
    providersOff: () => [],
    sidebar,
    mutateSidebar: () => Effect.succeed(sidebar()),
  };
}

async function exportFile(
  directory: string,
  listed: InstanceTransferOptions["settings"]["listedMcpServers"],
): Promise<{ path: string; urls: Record<string, string>; manifest: string }> {
  const uploads = join(directory, "uploads");
  await mkdir(uploads, { recursive: true });
  const service = emptyInstanceTransferService(uploads, [], undefined, settingsPort(sourceServers, listed, []));
  const path = join(directory, "export.zip");
  await run(service.exportTo(path, { agentIds: [], includeFiles: false, includeSettings: true }));
  const manifestBytes = unzipSync(await readFile(path))[INSTANCE_TRANSFER_MANIFEST];
  assert.ok(manifestBytes);
  const manifest = new TextDecoder().decode(manifestBytes);
  const parsed: { settings: { mcpServers: { name: string; url: string }[] } } = JSON.parse(manifest);
  return {
    path,
    manifest,
    urls: Object.fromEntries(parsed.settings.mcpServers.map((entry) => [entry.name, entry.url])),
  };
}

async function importFile(
  directory: string,
  path: string,
  listed: InstanceTransferOptions["settings"]["listedMcpServers"],
): Promise<{ urls: Record<string, string>; enabled: boolean[]; warnings: string[] }> {
  const uploads = join(directory, "uploads");
  await mkdir(uploads, { recursive: true });
  const saved: McpServerConfig[] = [];
  const service = emptyInstanceTransferService(uploads, [], undefined, settingsPort([], listed, saved));
  const preview = await run(service.stage(path));
  const result = await run(service.apply({ token: preview.token, keys: [], includeSettings: true }));
  return {
    urls: Object.fromEntries(saved.map((entry) => [entry.name, entry.url])),
    enabled: saved.map((entry) => entry.enabled),
    warnings: result.warnings,
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-transfer-mcp-"));
try {
  const catalog = await run(loadCatalogPluginServers(resolve(import.meta.dirname, "../resources/plugin-catalog")));
  const listedServers = catalog.filter((entry) => entry.transport === "http");
  check(
    "the real catalog lists Linear with its full address",
    listedServers.some((entry) => entry.url === LINEAR),
  );
  const listed = () => listedServers;

  const current = await exportFile(join(root, "current-export"), listed);
  check("a Marketplace app keeps its full address in the file", current.urls.linear === LINEAR);
  check(
    "a second account of a Marketplace app keeps its address and account",
    current.urls["linear-second"] === ACCOUNT,
  );
  check(
    "an address that is not in the catalog keeps only its origin",
    current.urls.notes === "https://notes.example.com",
  );
  check("a longer path on a catalog host keeps only its origin", current.urls.fal === "https://mcp.fal.ai");
  check("the file holds no secret", !current.manifest.includes(SECRET));

  const imported = await importFile(join(root, "current-import"), current.path, listed);
  check("the import saves the full Marketplace address", imported.urls.linear === LINEAR);
  check("the import saves the second account address", imported.urls["linear-second"] === ACCOUNT);
  check(
    "the import keeps the cut address of a server outside the catalog",
    imported.urls.notes === "https://notes.example.com",
  );
  check(
    "the import gives back the catalog address of a Marketplace app that the export cut",
    imported.urls.fal === "https://mcp.fal.ai/mcp-relay",
  );
  check(
    "the import does not give a catalog address to a server with another name",
    imported.urls["my-linear"] === "https://mcp.linear.app",
  );
  check(
    "each imported server is turned off",
    imported.enabled.every((enabled) => !enabled),
  );
  check(
    "a Marketplace app asks the user only to connect it again",
    imported.warnings.includes(sourceText("error.import.transferMcpSignIn", { name: "linear" })),
  );
  check(
    "a server outside the catalog still asks for its full address",
    imported.warnings.includes(sourceText("error.import.transferMcpValues", { name: "notes" })) &&
      imported.warnings.includes(sourceText("error.import.transferMcpValues", { name: "my-linear" })),
  );

  const older = await exportFile(join(root, "older-export"), undefined);
  check("an older export cuts the Marketplace address to its origin", older.urls.linear === "https://mcp.linear.app");
  const restored = await importFile(join(root, "older-import"), older.path, listed);
  check("the import gives back the Marketplace address of an older file", restored.urls.linear === LINEAR);
  check(
    "the import does not guess the path of a server outside the catalog",
    restored.urls.notes === "https://notes.example.com",
  );
  check(
    "the restored Marketplace app asks the user only to connect it again",
    restored.warnings.includes(sourceText("error.import.transferMcpSignIn", { name: "linear" })),
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, checks: report.checks.length, error: report.error }, null, 2)}\n`,
  );
}
