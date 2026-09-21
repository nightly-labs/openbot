// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "./agent-client";
import { AgentDatabaseSupervisor } from "./agent-data/agent-database-supervisor";
import { AgentTables } from "./agent-data/agent-tables";
import { spawnNodeDatabaseHost } from "./agent-data/node-database-host";
import type { AgentService } from "./agent-service";
import {
  callOpenBotTool,
  createTestService,
  FakeAgentClient,
  openBotToolPayload,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "./agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

async function startService(): Promise<{ client: FakeAgentClient; threadId: string }> {
  const { store, mailbox } = stores(root);
  const clients = new Map<AgentProvider, FakeAgentClient>();
  service = createTestService({
    store,
    mailbox,
    preferredProvider: "codex",
    tables: new AgentTables({
      sharedRoot: store.sharedRoot,
      supervisor: new AgentDatabaseSupervisor({ spawnHost: spawnNodeDatabaseHost }),
    }),
    clientFactory: (provider) => {
      const client = new FakeAgentClient(provider, "", false);
      clients.set(provider, client);
      return client;
    },
  });
  await service.initialize();
  await store.getOrCreate("chief");
  await service.sendMessage({ agentId: "chief", text: "Track the people I contacted." });
  await waitFor(() => Boolean(store.activeProviderSession("chief")?.externalSessionId));
  const client = clients.get("codex");
  const threadId = store.activeProviderSession("chief")?.externalSessionId;
  if (!client || !threadId) throw new Error("Provider session did not start.");
  return { client, threadId };
}

describe.sequential("AgentService: shared data tools", () => {
  it("creates a table, writes a row, and reads it back", async () => {
    const { client, threadId } = await startService();

    await callOpenBotTool(client, threadId, "execute_data", {
      sql: "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT UNIQUE)",
    });
    await callOpenBotTool(client, threadId, "execute_data", {
      sql: "INSERT INTO people (name) VALUES (?)",
      params: ["Ada"],
    });

    const read = await callOpenBotTool(client, threadId, "query_data", { sql: "SELECT name FROM people" });
    expect(openBotToolPayload(read.result)).toMatchObject({ rows: [["Ada"]] });
    // The agent that ran the CREATE owns the table, with no separate call to claim it.
    expect(await service?.listTables()).toMatchObject([{ name: "people", ownerAgentId: "chief", rowCount: 1 }]);
  });

  it("answers a refused statement as a tool result, not a server error", async () => {
    const { client, threadId } = await startService();

    const refused = await callOpenBotTool(client, threadId, "query_data", { sql: "PRAGMA journal_mode" });

    expect(refused.error).toBeUndefined();
    expect(refused.result).toMatchObject({ success: false });
    expect(openBotToolPayload(refused.result).error).toEqual(expect.stringContaining("list_tables"));
    expect(client.errors).toEqual([]);
  });
});
