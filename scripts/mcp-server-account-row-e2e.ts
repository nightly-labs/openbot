import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { mcpAccountFragment, withoutMcpAccountFragment } from "@openbot/contracts/mcp-accounts";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { mcpOAuthAccountKey } from "../src/backend/mcp-oauth-provider";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-server-account-row-e2e");
const ADDRESS = "https://mcp.example.com/mcp";
const LEGACY = "https://legacy.example/mcp";

const draft = (name: string, fields: Partial<McpServerConfig>): McpServerConfig => ({
  id: "",
  name,
  transport: "http",
  enabled: true,
  command: "",
  args: [],
  env: [],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [],
  ...fields,
});

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-account-row-"));
const database = new OpenBotDatabase(root);
const steps: Array<{ step: string; detail: unknown }> = [];
const report: { passed: boolean; steps: typeof steps; warnings: string[]; failures: string[] } = {
  passed: false,
  steps,
  warnings: [],
  failures: [],
};

try {
  await runCauseEffect(database.initialize());
  const store = new McpServerStore(
    database,
    createOpenBotLogger("mcp-server-store", (line) => report.warnings.push(line)),
  );
  const gateway = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("agent-service", () => undefined),
    hooks: { emitError: () => undefined, refreshAllAgentRuntimes: () => Effect.void },
  });
  const save = (config: McpServerConfig) => runCauseEffect(gateway.save({ config }));
  const row = (name: string) => {
    const found = store.list().find((config) => config.name === name);
    assert.ok(found, `the row ${name} is saved`);
    return found;
  };

  await save(draft("work", { url: ADDRESS }));
  const work = row("work");
  assert.equal(work.url, ADDRESS, "the first row keeps the address");
  steps.push({ step: "first row keeps the address", detail: work.url });

  await save(draft("personal", { url: ADDRESS }));
  const personal = row("personal");
  assert.ok(mcpAccountFragment(personal.url), "a row on a used address gets an account fragment");
  assert.equal(withoutMcpAccountFragment(personal.url), ADDRESS, "the address of the row stays the same");
  assert.notEqual(mcpOAuthAccountKey(personal.url), mcpOAuthAccountKey(work.url), "each row signs in on its own");
  steps.push({ step: "second row gets its own account", detail: personal.url });

  await save({ ...work, name: "work-renamed" });
  assert.equal(row("work-renamed").url, ADDRESS, "a rename keeps the account of the row");
  steps.push({ step: "a rename keeps the account", detail: row("work-renamed").url });

  await save(draft("agency", { url: ADDRESS }));
  const agency = row("agency");
  assert.notEqual(mcpOAuthAccountKey(agency.url), mcpOAuthAccountKey(personal.url));
  assert.notEqual(mcpOAuthAccountKey(agency.url), mcpOAuthAccountKey(work.url));
  steps.push({ step: "third row gets its own account", detail: agency.url });

  await save(draft("other", { url: "https://other.example/mcp" }));
  assert.equal(row("other").url, "https://other.example/mcp", "a row on a free address keeps it");
  steps.push({ step: "a free address is kept", detail: row("other").url });

  await save(draft("copy", { url: personal.url }));
  const copy = row("copy");
  assert.notEqual(
    mcpOAuthAccountKey(copy.url),
    mcpOAuthAccountKey(personal.url),
    "a copied account row gets its own account",
  );
  steps.push({ step: "a copied account row gets its own account", detail: copy.url });

  const tested = `${ADDRESS}#account-tested-before-save`;
  await save(draft("tested", { url: tested }));
  assert.equal(row("tested").url, tested, "a row keeps the free account that its client tested and signed in");
  steps.push({ step: "a row keeps the account that its client signed in before the save", detail: row("tested").url });

  const other = row("other");
  await save({ ...other, url: ADDRESS });
  const moved = row("other");
  assert.notEqual(
    mcpOAuthAccountKey(moved.url),
    mcpOAuthAccountKey(work.url),
    "a row that moves to a used address gets its own account",
  );
  steps.push({ step: "a row that moves to a used address gets its own account", detail: moved.url });

  const insert = database.connection.prepare(
    `INSERT INTO projection_mcp_servers (
       mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
       working_directory, url, headers_json, position, created_at, updated_at
     ) VALUES (?, ?, 'http', 1, '', '[]', '[]', '[]', '', ?, '[]', ?, '2026-11-24T00:00:00.000Z', '2026-11-24T00:00:00.000Z')`,
  );
  insert.run("mcp-legacy-a", "legacy-a", LEGACY, 90);
  insert.run("mcp-legacy-b", "legacy-b", LEGACY, 91);
  const legacy = row("legacy-a");
  const legacyKey = mcpOAuthAccountKey(legacy.url);
  await save({ ...legacy, name: "legacy-a-renamed" });
  const kept = row("legacy-a-renamed");
  assert.equal(kept.url, LEGACY, "a rename keeps the sign-in of a row that shares its address");
  assert.equal(mcpOAuthAccountKey(kept.url), legacyKey, "the sign-in of the row stays under its key");
  steps.push({ step: "a legacy row keeps its sign-in", detail: kept.url });

  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${steps.length} steps. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
