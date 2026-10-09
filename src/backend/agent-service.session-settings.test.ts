// @vitest-environment node
import { join } from "node:path";
import type { AgentSessionSettingsSnapshot, AgentSessionSettingValue } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionSettingsOverrides } from "./agent/session-settings";
import type { AgentService } from "./agent-service";
import {
  FakeAgentClient,
  notification,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
} from "./agent-service-test-harness";
import { AgentStore } from "./agent-store";
import { runCauseEffect } from "./effect-boundary";
import { getString } from "./protocol";

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

class SettingsClient extends FakeAgentClient {
  readonly values = new Map<string, boolean>();
  readonly changes: Array<{ threadId: string; value: AgentSessionSettingValue }> = [];
  readSessionSettings(threadId: string): Effect.Effect<AgentSessionSettingsSnapshot> {
    return Effect.sync(() => ({
      options: [
        { id: "compact", name: "Compact replies", type: "boolean", currentValue: this.values.get(threadId) ?? false },
      ],
    }));
  }
  setSessionSetting(
    threadId: string,
    _id: string,
    value: AgentSessionSettingValue,
  ): Effect.Effect<AgentSessionSettingsSnapshot> {
    this.changes.push({ threadId, value });
    this.values.set(threadId, value === true);
    return this.readSessionSettings(threadId);
  }
}

// Failure modes: overrides disappear on reload, a reset changes the public thread, busy edits
// change an active turn, a notification read writes a normalized option again, or another custom
// agent receives a saved value. Use the real service,
// mailbox and SQLite store, with only the external provider boundary replaced.
describe("Agent session settings", () => {
  it("saves overrides across reload and resets without changing the public thread", async () => {
    const clients: SettingsClient[] = [];
    const started = await startService(root, {
      client: (provider) => {
        const client = new SettingsClient(provider);
        clients.push(client);
        return client;
      },
    });
    service = started.service;
    await runCauseEffect(started.store.getOrCreate("chief"));
    const initial = await runCauseEffect(service.readAgentSessionSettings("chief"));
    expect(initial.overrides).toEqual({});
    const before = started.store.list().find((agent) => agent.id === "chief");
    const saved = await runCauseEffect(
      service.setAgentSessionSetting({ agentId: "chief", settingId: "compact", value: true }),
    );
    expect(saved.overrides).toEqual({ compact: true });
    expect(saved.pending).toBe(false);
    const client = clients.find((candidate) => candidate.changes.length > 0);
    if (!client) throw new Error("Missing settings client.");
    // The provider can normalize a choice after applying it. Repeated notification reads
    // must report the difference without another write or an event/write loop.
    client.values.clear();
    for (let read = 0; read < 2; read++) {
      const normalized = await runCauseEffect(service.readAgentSessionSettings("chief"));
      expect(normalized.options[0]?.currentValue).toBe(false);
      expect(normalized.overrides).toEqual({ compact: true });
      expect(normalized.pending).toBe(true);
    }
    expect(client.changes).toHaveLength(1);
    const restored = new AgentStore(join(root, "user-data"), join(root, "home"));
    await runCauseEffect(restored.initialize());
    expect(restored.list().find((agent) => agent.id === "chief")?.sessionSettingOverrides).toEqual({
      codex: { compact: true },
    });
    restored.database.close();
    const reset = await runCauseEffect(service.resetAgentSessionSetting({ agentId: "chief", settingId: "compact" }));
    expect(reset.overrides).toEqual({});
    expect(reset.options[0]?.currentValue).toBe(false);
    const after = started.store.list().find((agent) => agent.id === "chief");
    expect(after?.threadId).toBe(before?.threadId);
    expect(after?.workspacePath).toBe(before?.workspacePath);
    expect(clients[0]?.releasedThreads.length).toBeGreaterThan(0);
  });

  it("saves busy changes for the next turn and emits idle option changes", async () => {
    const client = new SettingsClient("codex", "DONE", false);
    const started = await startService(root, { client: () => client });
    service = started.service;
    await runCauseEffect(started.store.getOrCreate("chief"));
    await runCauseEffect(service.readAgentSessionSettings("chief"));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Work", attachmentDraftIds: [] }));
    await waitFor(() => client.requests.some((request) => request.method === "turn/start"));
    const changed = await runCauseEffect(
      service.setAgentSessionSetting({ agentId: "chief", settingId: "compact", value: true }),
    );
    expect(changed.pending).toBe(true);
    expect(client.changes).toEqual([]);
    expect(started.store.list().find((agent) => agent.id === "chief")?.sessionSettingOverrides).toEqual({
      codex: { compact: true },
    });
    const threadId = getString(client.requests.find((request) => request.method === "turn/start")?.params, "threadId");
    if (!threadId) throw new Error("Missing provider thread.");
    const changedEvent = new Promise<string>((resolve) => {
      service?.on("event", (event) => {
        if (event.type === "agent-session-settings-changed") resolve(event.agentId);
      });
    });
    client.emit("notification", notification("openbot/sessionSettings/updated", { threadId, options: [] }));
    expect(await changedEvent).toBe("chief");
    const reset = await runCauseEffect(service.resetAgentSessionSetting({ agentId: "chief", settingId: "compact" }));
    expect(reset.pending).toBe(true);
    expect(started.store.list().find((agent) => agent.id === "chief")?.sessionSettingResets).toEqual(["codex"]);
    await runCauseEffect(service.stop());
    service = null;
    const restarted = await startService(root, {
      client: (provider) => {
        const next = new SettingsClient(provider);
        next.sessionIdPrefix = `${provider}-restarted`;
        return next;
      },
    });
    service = restarted.service;
    const restored = await runCauseEffect(service.readAgentSessionSettings("chief"));
    expect(restored.overrides).toEqual({});
    expect(restored.options[0]?.currentValue).toBe(false);
    expect(restarted.store.list().find((agent) => agent.id === "chief")?.sessionSettingResets).toEqual([]);
  });
  it("keeps custom-agent settings separate when the selected agent changes", async () => {
    const started = await startService(root, { provider: "codex" });
    service = started.service;
    await runCauseEffect(started.store.getOrCreate("chief"));
    started.store.setSessionSettingOverrides("chief", {
      "acp:first": { compact: true },
      "acp:second": { compact: false },
    });
    const first = await runCauseEffect(
      started.store.updateAgent({ agentId: "chief", provider: "acp", model: "first/default" }),
    );
    expect(sessionSettingsOverrides(first)).toEqual({ compact: true });
    const second = await runCauseEffect(
      started.store.updateAgent({ agentId: "chief", provider: "acp", model: "second/default" }),
    );
    expect(sessionSettingsOverrides(second)).toEqual({ compact: false });
    expect(second.id).toBe(first.id);
    expect(second.workspacePath).toBe(first.workspacePath);
    const restored = new AgentStore(join(root, "user-data"), join(root, "home"));
    await runCauseEffect(restored.initialize());
    expect(restored.list().find((agent) => agent.id === "chief")?.sessionSettingOverrides).toEqual({
      "acp:first": { compact: true },
      "acp:second": { compact: false },
    });
    restored.database.close();
  });
});
