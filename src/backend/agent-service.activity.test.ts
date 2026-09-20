// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "./agent-service";
import { startAgentTestFixture, startService, stopAgentTestFixture } from "./agent-service-test-harness";

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});

afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: restart activity", () => {
  it("reports idle with nothing queued and no provider work", async () => {
    const started = await startService(root, { provider: "codex" });
    service = started.service;
    await started.store.getOrCreate("chief");
    expect(service.hasActiveWork()).toEqual([]);
  });

  it("reports queued work right after a message arrives", async () => {
    const started = await startService(root, { provider: "codex" });
    service = started.service;
    await started.store.getOrCreate("chief");
    await started.mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: ["chief"],
      text: "Hold the restart",
    });
    expect(service.hasActiveWork().length).toBeGreaterThan(0);
  });
});
