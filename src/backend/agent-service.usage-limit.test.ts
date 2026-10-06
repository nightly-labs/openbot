// @vitest-environment node
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPlanLimitDiagnostic, isUsageLimitDiagnostic } from "./agent/provider-diagnostics";
import { USAGE_LIMIT_RECHECK_MS } from "./agent/usage-limit-gate";
import type { AgentProvider } from "./agent-client";
import type { AgentService } from "./agent-service";
import {
  FakeAgentClient,
  notification,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "./agent-service-test-harness";
import { getRecord, getString, type ResponseDecoder } from "./protocol";

const SESSION_LIMIT = "You've hit your session limit · resets 8:40pm (Europe/Budapest)";

/** Refuses each turn with `limit` while it is set; otherwise answers. `act` runs a command first. */
class PlanClient extends FakeAgentClient {
  limit: string | null = SESSION_LIMIT;
  act = false;
  turnStarts = 0;

  constructor(provider: AgentProvider) {
    super(provider, "", false);
  }

  override async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    const result = await super.request(method, params, decoder);
    if (method !== "turn/start") return result;
    this.turnStarts += 1;
    const threadId = getString(params, "threadId");
    const turnId = getString(getRecord(result, "turn"), "id");
    const { limit, act } = this;
    setTimeout(() => {
      if (act) {
        const item = { id: `${turnId}:command`, type: "commandExecution", command: "ls" };
        this.emit("notification", notification("item/completed", { threadId, turnId, item }));
      }
      if (limit) this.emit("notification", notification("error", { threadId, turnId, message: limit }));
      else {
        const item = { id: `${turnId}:assistant`, type: "agentMessage", text: "Done." };
        this.emit("notification", notification("item/completed", { threadId, turnId, item }));
      }
      const status = limit ? "failed" : "completed";
      this.emit("notification", notification("turn/completed", { threadId, turn: { id: turnId, status } }));
    }, 0);
    return result;
  }
}

let root: string;
let service: AgentService | null = null;

beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
  // The provider start reads files and spawns `--version`, so the clock keeps moving with real time.
  // Only the recheck interval is skipped by hand.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe.sequential("AgentService: usage limit", () => {
  it("holds the queue of a spent plan, announces it once, and runs it after the plan resets", async () => {
    const client = new PlanClient("codex");
    const started = await startService(root, { provider: "codex", client: () => client });
    service = started.service;
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    const first = await service.sendMessage({ agentId: "chief", text: "Write the morning plan." });
    await waitFor(() => events.some((event) => event.type === "usage-limit-reached"));
    // The gate is closed now, and `scheduleDrain` reads it before it starts anything.
    const second = await service.sendMessage({ agentId: "chief", text: "Build ended with code 1." });

    // The refused message is back in the queue, and the next one does not start into the same refusal.
    expect(client.turnStarts).toBe(1);
    expect(service.listQueue("chief").deliveries.map((delivery) => delivery.status)).toEqual(["queued", "queued"]);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.filter((event) => event.type === "usage-limit-reached")).toEqual([
      { type: "usage-limit-reached", agentId: "chief", provider: "codex", resetsAt: null, agentCount: 1 },
    ]);
    expect(service.getRuntimeSnapshot().usageLimits).toEqual([{ agentId: "chief", resetsAt: null }]);

    // No reset was reported, so a usage read after the recheck interval finds the plan free again.
    client.limit = null;
    await vi.advanceTimersByTimeAsync(USAGE_LIMIT_RECHECK_MS);
    const status = (receipt: typeof first) =>
      started.mailbox.getDelivery(receipt.deliveries[0]?.id ?? "")?.delivery.status;
    await waitFor(() => status(first) === "completed" && status(second) === "completed");

    expect(client.turnStarts).toBe(3);
    expect(service.getRuntimeSnapshot().usageLimits).toEqual([]);
    expect(events.filter((event) => event.type === "usage-limit-reached")).toHaveLength(1);
  });

  it("runs the held queue at once when the agent moves to another model of the same provider", async () => {
    const client = new PlanClient("codex");
    const started = await startService(root, { provider: "codex", client: () => client });
    service = started.service;
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));

    const receipt = await service.sendMessage({ agentId: "chief", text: "Write the morning plan." });
    await waitFor(() => events.some((event) => event.type === "usage-limit-reached"));
    client.limit = null;
    const current = started.store.list().find((agent) => agent.id === "chief")?.model;
    await service.updateAgent({ agentId: "chief", model: current === "gpt-5.4" ? "gpt-5.5" : "gpt-5.4" });

    const delivery = () => started.mailbox.getDelivery(receipt.deliveries[0]?.id ?? "")?.delivery;
    await waitFor(() => delivery()?.status === "completed");
    expect(service.getRuntimeSnapshot().usageLimits).toEqual([]);
  });

  it("fails a refused turn that already ran a command, so the command does not run twice", async () => {
    const client = new PlanClient("codex");
    client.act = true;
    const started = await startService(root, { provider: "codex", client: () => client });
    service = started.service;

    const receipt = await service.sendMessage({ agentId: "chief", text: "Clean the build folder." });
    const delivery = () => started.mailbox.getDelivery(receipt.deliveries[0]?.id ?? "")?.delivery;
    await waitFor(() => delivery()?.status === "failed");

    expect(delivery()?.error).toBe(SESSION_LIMIT);
    expect(service.getRuntimeSnapshot().usageLimits).toEqual([{ agentId: "chief", resetsAt: null }]);
  });

  it("drops the run of a routine set to skip instead of holding it for the reset", async () => {
    const client = new PlanClient("codex");
    const started = await startService(root, { provider: "codex", client: () => client });
    service = started.service;
    await started.store.getOrCreate("chief");
    const routine = service.createRoutine({
      agentId: "chief",
      name: "Morning plan",
      instruction: "Write the plan.",
      active: true,
      timezone: "UTC",
      schedule: { kind: "daily", time: "08:00" },
      limitPolicy: "skip",
    });

    const run = await service.testRoutine({ agentId: "chief", routineId: routine.id });
    const status = () =>
      service?.listRoutineRuns({ agentId: "chief", routineId: routine.id }).find((item) => item.id === run.id)?.status;
    await waitFor(() => status() === "cancelled");

    expect(client.turnStarts).toBe(1);
    expect(started.mailbox.getDelivery(run.deliveryId ?? "")?.delivery.status).toBe("cancelled");

    // A run that arrives during the hold is dropped at once. A local script run takes the same path.
    const late = await service.testRoutine({ agentId: "chief", routineId: routine.id });
    expect(late).toMatchObject({ status: "cancelled", deliveryId: null });
    expect(client.turnStarts).toBe(1);
  });

  it("holds work for a spent plan window, not for a throttle or a spent balance", () => {
    expect(isPlanLimitDiagnostic(SESSION_LIMIT)).toBe(true);
    expect(isPlanLimitDiagnostic("You've hit your weekly limit · resets Oct 9")).toBe(true);
    expect(isPlanLimitDiagnostic("You've hit your usage limit. Try again at 10:34 AM.")).toBe(true);
    expect(isUsageLimitDiagnostic("You've hit your rate limit. Try again in 20 seconds.")).toBe(false);
    expect(isUsageLimitDiagnostic("429 Rate limit reached for requests")).toBe(false);
    // A balance does not come back by waiting, so the turn fails with the provider's reason.
    for (const balance of [
      "Your credit balance is too low.",
      "You exceeded your current quota.",
      "insufficient_quota",
    ]) {
      expect(isUsageLimitDiagnostic(balance)).toBe(true);
      expect(isPlanLimitDiagnostic(balance)).toBe(false);
    }
  });
});
