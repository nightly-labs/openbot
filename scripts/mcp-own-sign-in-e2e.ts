import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { mcpAccountFragment, withOwnMcpAccount } from "@openbot/contracts/mcp-accounts";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { McpGateway } from "../src/backend/agent/mcp-gateway";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { mcpOAuthAccountKey } from "../src/backend/mcp-oauth-provider";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUTPUT = resolve(import.meta.dirname, "../.openbot-build/mcp-own-sign-in-e2e");
const SHARED = "https://mcp.example.com/mcp";
const OLD_SHARED = "https://old.example.com/mcp";
const FREE = "https://free.example.com/mcp";

interface Check {
  name: string;
  url: string;
}

function httpRow(name: string, url: string, id = ""): McpServerConfig {
  return {
    id,
    name,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url,
    headers: [],
  };
}

const folder = await mkdtemp(join(tmpdir(), "openbot-mcp-own-sign-in-"));
const database = new OpenBotDatabase(folder);
const checks: Check[] = [];
const failures: string[] = [];
let gateway: McpGateway | undefined;

try {
  await runCauseEffect(database.initialize());
  const store = new McpServerStore(
    database,
    createOpenBotLogger("mcp-server-store", () => undefined),
  );
  const opened = new McpGateway({
    servers: store,
    credentials: NO_PROVIDER_CREDENTIALS,
    computerUseMcpServer: () => null,
    logger: createOpenBotLogger("mcp-gateway", () => undefined),
    hooks: {
      emitError: () => undefined,
      refreshAllAgentRuntimes: () => Effect.void,
      mcpToolsChanged: () => Effect.void,
    },
  });
  gateway = opened;
  const save = (config: McpServerConfig) => runCauseEffect(opened.save({ config }));
  const named = (name: string) => {
    const row = store.list().find((candidate) => candidate.name === name);
    assert.ok(row, `${name} is saved`);
    return row;
  };
  const account = (url: string) => mcpOAuthAccountKey(url);
  const record = (name: string) => checks.push({ name, url: named(name).url });

  await save(httpRow("work", SHARED));
  assert.equal(named("work").url, SHARED);
  record("work");

  const drafted = withOwnMcpAccount(httpRow("personal", SHARED), store.list(), "form-draft");
  assert.equal(mcpAccountFragment(drafted.url), "#account-form-draft");
  assert.deepEqual(opened.accountConfig(drafted), drafted, "the host keeps the account that the form signed in");
  await save(drafted);
  assert.equal(named("personal").url, drafted.url, "the saved row has the account of the pre-save sign-in");
  assert.notEqual(account(named("personal").url), account(SHARED));
  record("personal");

  await save(httpRow("released-client", SHARED));
  const released = named("released-client");
  assert.ok(mcpAccountFragment(released.url), "a plain draft from an older client gets its own account");
  assert.notEqual(account(released.url), account(SHARED));
  record("released-client");

  const probed = opened.accountConfig(httpRow("agent-tool", SHARED));
  assert.ok(mcpAccountFragment(probed.url), "the agent tool probes the account that the row will have");
  await save(probed);
  assert.equal(named("agent-tool").url, probed.url, "the agent tool saves the account that it probed");
  record("agent-tool");

  const work = named("work");
  assert.deepEqual(opened.accountConfig(work), work, "a reconnect of a saved row keeps its account");
  await save({ ...work, name: "work-renamed" });
  assert.equal(named("work-renamed").url, SHARED, "a rename keeps the account");
  record("work-renamed");

  await save(httpRow("copy", named("personal").url));
  assert.notEqual(account(named("copy").url), account(named("personal").url), "a copy gets its own account");
  record("copy");

  await save(httpRow("docs-anchor", `${SHARED}#docs`));
  assert.ok(mcpAccountFragment(named("docs-anchor").url), "another fragment becomes an account fragment");
  assert.notEqual(account(named("docs-anchor").url), account(SHARED));
  record("docs-anchor");

  await save(httpRow("elsewhere", FREE));
  assert.equal(named("elsewhere").url, FREE, "a free address stays as it is");
  await save({ ...named("elsewhere"), url: SHARED });
  assert.notEqual(account(named("elsewhere").url), account(SHARED), "a move to a used address gets its own account");
  record("elsewhere");

  store.save(httpRow("old-a", OLD_SHARED));
  store.save(httpRow("old-b", OLD_SHARED));
  await save({ ...named("old-a"), name: "old-a-renamed", enabled: false });
  assert.equal(named("old-a-renamed").url, OLD_SHARED, "rows that already share an address keep their sign-in");
  record("old-a-renamed");

  const split = withOwnMcpAccount(
    { ...named("old-b"), url: `${OLD_SHARED}#account-old-b` },
    [named("old-a-renamed")],
    "unused",
  );
  await save(split);
  assert.equal(
    named("old-b").url,
    `${OLD_SHARED}#account-old-b`,
    "an edit with an account fragment splits a shared row",
  );
  assert.notEqual(account(named("old-b").url), account(OLD_SHARED));
  record("old-b");

  const shown = withOwnMcpAccount(httpRow("free-draft", "https://another.example.com/mcp"), store.list(), "unused");
  assert.equal(shown.url, "https://another.example.com/mcp", "the form leaves a free address as it is");
} catch (error) {
  failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  if (gateway) await runCauseEffect(gateway.close());
  database.close();
  await rm(folder, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(
    join(OUTPUT, "report.json"),
    `${JSON.stringify({ passed: failures.length === 0, checks, failures }, null, 2)}\n`,
  );
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`PASS ${checks.length} rows. Report: ${join(OUTPUT, "report.json")}\n`);
