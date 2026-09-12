// @vitest-environment node

import type { AgentEvent, AgentSummary } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { describe, expect, it } from "vitest";
import { notificationForAgentEvent } from "./agent-notifications";

const agent = {
  id: "chief",
  provider: "codex",
  name: "Chief",
  notifications: true,
  title: "Lead",
  description: "",
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  threadId: "thread-chief",
  workspacePath: "/tmp/chief",
  preview: "",
  updatedAt: null,
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
} satisfies AgentSummary;

describe("notificationForAgentEvent", () => {
  const translate = translateFor("en");
  it("surfaces completed work and prompts for enabled agents", () => {
    expect(notificationForAgentEvent(completed("completed"), [agent], translate)).toEqual({
      title: "Chief",
      body: "Finished working.",
      silent: true,
    });
    expect(
      notificationForAgentEvent(
        {
          type: "prompt",
          agentId: "chief",
          threadId: "thread-chief",
          turnId: "turn-1",
          requestId: 1,
          questions: [],
        },
        [agent],
        translate,
      ),
    ).toEqual({ title: "Chief", body: "Needs your input." });
  });

  it("ignores disabled agents, non-successful turns, and unrelated events", () => {
    expect(notificationForAgentEvent(completed("failed"), [agent], translate)).toBeNull();
    expect(
      notificationForAgentEvent(completed("completed"), [{ ...agent, notifications: false }], translate),
    ).toBeNull();
    expect(notificationForAgentEvent({ type: "agents-changed", agents: [] }, [agent], translate)).toBeNull();
  });
});

function completed(status: string): AgentEvent {
  return {
    type: "turn-completed",
    agentId: "chief",
    threadId: "thread-chief",
    turnId: "turn-1",
    status,
  };
}
