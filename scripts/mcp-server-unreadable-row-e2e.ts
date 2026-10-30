// Drives issue #3643 on the real modules: the SQLite MCP store and McpGateway, over a database that
// holds MCP rows this build cannot read. The startup read must not throw, and the user must be able to
// see, correct and remove the row. No provider or account is used.
// bun scripts/mcp-server-unreadable-row-e2e.ts. Writes .openbot-build/mcp-server-unreadable-row-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeMcpServerConfigs, type McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpServerError, McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-server-unreadable-row-e2e");
const HEADER_SECRET = "header-secret-5e19c3";

const draft = (name: string, fields: Partial<McpServerConfig>): McpServerConfig => ({
  id: "",
  name,
  transport: "stdio",
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

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-unreadable-row-"));
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
  // Each line the store logs is kept, to check that a row is said once and no value is.
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

  store.save(draft("alpha", { command: "node", args: ["server.js"] }));
  store.save(
    draft("beta", { transport: "http", url: "https://beta.example/mcp", headers: [{ key: "X-Key", value: "b" }] }),
  );
  const insert = database.connection.prepare(
    `INSERT INTO projection_mcp_servers (
       mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
       working_directory, url, headers_json, position, created_at, updated_at
     ) VALUES (?, ?, ?, 1, '', '[]', '[]', '[]', ?, ?, ?, ?, '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z')`,
  );
  // The shape the issue reports: headers as an object, not as a list of pairs.
  const objectHeaders = JSON.stringify({ Authorization: `Bearer ${HEADER_SECRET}` });
  insert.run("mcp-object-headers", "object-headers", "http", "", "https://object.example/mcp", objectHeaders, 2);
  // A column that is not text at all: nothing of this row can be shown.
  insert.run("mcp-blob-folder", "blob-folder", "http", new Uint8Array([0]), "https://blob.example/mcp", "[]", 3);
  // Rows an earlier build or an import could store past the bounds that the renderer decodes with.
  const insertStdio = database.connection.prepare(
    `INSERT INTO projection_mcp_servers (
       mcp_server_id, name, transport, enabled, command, args_json, env_json, env_passthrough_json,
       working_directory, url, headers_json, position, created_at, updated_at
     ) VALUES (?, ?, 'stdio', 1, ?, ?, '[]', '[]', '', '', '[]', ?, '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z')`,
  );
  const manyArgs = JSON.stringify(Array.from({ length: 65 }, (_, index) => `--arg-${index}`));
  insertStdio.run("mcp-many-args", "many-args", "node", manyArgs, 4);
  insertStdio.run("mcp-long-command", "long-command", "n".repeat(5_000), "[]", 5);
  insertStdio.run("mcp-long-name", "x".repeat(100), "node", "[]", 6);

  // The startup path of the issue: AgentService.enabledMcpServers() -> McpGateway.enabled().
  const enabled = gateway.enabled().map((config) => config.name);
  assert.deepEqual(enabled, ["alpha", "beta"]);
  steps.push({ step: "startup read", detail: enabled });

  const listed = store.list();
  assert.deepEqual(
    listed.map((config) => config.name),
    ["alpha", "beta", "object-headers", "many-args", "long-command"],
  );
  // What the preload does with the list: one config past a bound would fail all of them.
  decodeMcpServerConfigs(listed);
  const tooMany = listed.find((config) => config.name === "many-args");
  assert.ok(tooMany);
  assert.equal(tooMany.enabled, false, "a row past a list bound reads as turned off");
  assert.deepEqual(tooMany.args, []);
  assert.equal(tooMany.command, "node");
  const longCommand = listed.find((config) => config.name === "long-command");
  assert.ok(longCommand);
  assert.equal(longCommand.enabled, false, "a row past a text bound reads as turned off");
  assert.equal(longCommand.command, "");
  // Turned on as shown, it has no command: the save says what to correct, and the row stays.
  assert.throws(
    () => store.setEnabled("mcp-long-command", true),
    (error: unknown) =>
      error instanceof McpServerError && error.message === "Enter the command that launches this server.",
  );
  steps.push({ step: "rows past a bound read as off", detail: [tooMany, longCommand] });
  const shown = listed.find((config) => config.name === "object-headers");
  assert.ok(shown);
  assert.equal(shown.enabled, false, "an unreadable row reads as turned off");
  assert.deepEqual(shown.headers, [], "an unreadable column reads as empty");
  assert.equal(shown.url, "https://object.example/mcp");
  steps.push({ step: "list shows the row off", detail: shown });

  const raw = () =>
    database.connection
      .prepare("SELECT enabled, headers_json FROM projection_mcp_servers WHERE mcp_server_id = 'mcp-object-headers'")
      .get();
  assert.deepEqual({ ...raw() }, { enabled: 1, headers_json: objectHeaders }, "a read does not change the row");
  steps.push({ step: "row unchanged by reads", detail: "enabled 1, headers kept" });

  assert.equal(
    report.warnings.filter((line) => line.includes("mcp-object-headers")).length,
    1,
    "the row is reported once",
  );
  assert.equal(report.warnings.filter((line) => line.includes("mcp-blob-folder")).length, 1);
  assert.equal(report.warnings.filter((line) => line.includes("mcp-many-args")).length, 1);
  assert.equal(report.warnings.filter((line) => line.includes("mcp-long-command")).length, 1);
  assert.equal(report.warnings.filter((line) => line.includes("mcp-long-name")).length, 1);
  assert.ok(!report.warnings.join("\n").includes(HEADER_SECRET), "a stored value reached the log");
  steps.push({ step: "logged once without values", detail: report.warnings.length });

  // A name the store refuses is refused by the table, so the skipped row keeps its name.
  assert.throws(
    () => store.save(draft("blob-folder", { transport: "http", url: "https://other.example/mcp" })),
    (error: unknown) =>
      error instanceof McpServerError &&
      error.message === sourceText("error.backend.mcpServerNameTaken", { name: "blob-folder" }),
  );
  steps.push({ step: "skipped row keeps its name", detail: "name taken" });

  // A header key longer than the read guard allows - what a Hermes import could hand over.
  const longKey = "k".repeat(300);
  assert.throws(
    () =>
      store.save(
        draft("long-key", {
          transport: "http",
          url: "https://long.example/mcp",
          headers: [{ key: longKey, value: "v" }],
        }),
      ),
    (error: unknown) =>
      error instanceof McpServerError && error.message === sourceText("error.backend.mcpServerInvalid"),
  );
  assert.equal(
    store.list().some((config) => config.name === "long-key"),
    false,
  );
  steps.push({ step: "save refuses a row it cannot read back", detail: "mcpServerInvalid" });

  // The row already reads as off: turning it off keeps its stored values.
  assert.equal(store.setEnabled("mcp-object-headers", false).enabled, false);
  assert.deepEqual({ ...raw() }, { enabled: 0, headers_json: objectHeaders }, "turning off erased the row");
  steps.push({ step: "turn off keeps the row", detail: "enabled 0, headers kept" });

  // Turning the row on stores it as it is shown, so it stays on after the next read.
  const turnedOn = store.setEnabled("mcp-object-headers", true);
  assert.equal(turnedOn.enabled, true);
  assert.deepEqual({ ...raw() }, { enabled: 1, headers_json: "[]" });
  assert.equal(store.get("mcp-object-headers")?.enabled, true);
  assert.deepEqual(
    gateway.enabled().map((config) => config.name),
    ["alpha", "beta", "object-headers"],
  );
  steps.push({ step: "turn on repairs the row", detail: turnedOn });

  // The user corrects the row in Server settings: a save replaces it with what the form shows.
  const corrected = store.save({ ...turnedOn, headers: [{ key: "Authorization", value: "Bearer new" }] });
  assert.deepEqual(store.get(corrected.id)?.headers, [{ key: "Authorization", value: "Bearer new" }]);
  steps.push({ step: "save corrects the row", detail: corrected.id });

  store.remove("mcp-object-headers");
  store.remove("mcp-blob-folder");
  store.remove("mcp-many-args");
  store.remove("mcp-long-command");
  store.remove("mcp-long-name");
  assert.deepEqual(
    store.list().map((config) => config.name),
    ["alpha", "beta"],
  );
  store.save(draft("blob-folder", { transport: "http", url: "https://other.example/mcp" }));
  steps.push({ step: "remove and re-add", detail: store.list().map((config) => config.name) });

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
