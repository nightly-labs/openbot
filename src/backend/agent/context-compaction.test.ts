// @vitest-environment node
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  createTestService,
  protocolMessages,
  startAgentTestFixture,
  stopAgentTestFixture,
  stores,
  waitFor,
} from "../agent-service-test-harness";

let root: string;
let logPath: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root, logPath } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("ContextCompaction: pressure, threshold and failure", () => {
  it("compacts a pressured agent context before draining its next queued message", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "First large task" });
    await service.sendMessage({ agentId: "chief", text: "Run after compaction" });
    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });

    const lifecycle = (await protocolMessages(logPath))
      .filter((message) => ["turn/start", "thread/compact/start"].includes(String(message.method)))
      .map((message) => message.method);
    expect(lifecycle.slice(0, 3)).toEqual(["turn/start", "thread/compact/start", "turn/start"]);
    expect(lifecycle.filter((method) => method === "thread/compact/start")).toHaveLength(1);
    expect(events.filter((event) => event.type === "turn-started")).toHaveLength(2);
  });

  it("does not compact context below the safety threshold", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "79000";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();
    await service.sendMessage({ agentId: "chief", text: "Normal task" });
    await waitFor(() => service?.listQueue("chief").deliveries[0]?.status === "completed");

    expect((await protocolMessages(logPath)).some((message) => message.method === "thread/compact/start")).toBe(false);
  });

  it("continues queued work when an MCP server changes while the context is compacting", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    // Long enough to save a server inside the compaction, which is the window the deadlock needs.
    process.env.OPENBOT_FAKE_COMPACTION_DELAY = "400";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "First large task" });
    await service.sendMessage({ agentId: "chief", text: "Run after compaction" });
    await waitFor(async () =>
      (await protocolMessages(logPath)).some((message) => message.method === "thread/compact/start"),
    );

    // A compaction keeps no conversation turn id, so a refresh reads its thread as idle. Dropping
    // the routing here would lose the compaction's own completion, and the agent would hold its
    // queue for good.
    service.saveMcpServer({
      config: {
        id: "",
        name: "Filesystem",
        transport: "stdio",
        enabled: true,
        command: "/bin/echo",
        args: [],
        env: [],
        envPassthrough: [],
        workingDirectory: "",
        url: "",
        headers: [],
      },
    });

    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });
  });

  it("continues queued work when context compaction is unavailable", async () => {
    process.env.OPENBOT_FAKE_AUTO_COMPLETE = "DONE";
    process.env.OPENBOT_FAKE_CONTEXT_USAGE = "82000";
    process.env.OPENBOT_FAKE_COMPACTION_ERROR = "1";
    const { store, mailbox } = stores(root);
    service = createTestService({ store, mailbox });
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    await service.initialize();

    await service.sendMessage({ agentId: "chief", text: "First task" });
    await service.sendMessage({ agentId: "chief", text: "Must still run" });
    await waitFor(async () => {
      const messages = await protocolMessages(logPath);
      return messages.filter((message) => message.method === "turn/start").length === 2;
    });

    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "error", code: "context_compaction_failed" })]),
    );
  });
});
