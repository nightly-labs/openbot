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

const prompt: AgentEvent = {
  type: "prompt",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-1",
  requestId: 1,
  questions: [],
};

describe("notificationForAgentEvent", () => {
  const translate = translateFor("en");
  const target = { agentId: "chief", threadId: "thread-chief" };

  it("surfaces finished and failed work and prompts at the all level", () => {
    expect(notificationForAgentEvent(completed("completed"), [agent], translate, "all")).toEqual({
      title: "Chief",
      body: "Finished working.",
      ...target,
    });
    expect(notificationForAgentEvent(completed("failed"), [agent], translate, "all")).toEqual({
      title: "Chief",
      body: "Stopped with an error.",
      ...target,
    });
    expect(notificationForAgentEvent(prompt, [agent], translate, "all")).toEqual({
      title: "Chief",
      body: "Needs your input.",
      ...target,
    });
  });

  it("keeps only events that wait for the user at the needs-me level", () => {
    expect(notificationForAgentEvent(prompt, [agent], translate, "needs-me")).toEqual({
      title: "Chief",
      body: "Needs your input.",
      ...target,
    });
    expect(notificationForAgentEvent(completed("completed"), [agent], translate, "needs-me")).toBeNull();
    expect(notificationForAgentEvent(completed("failed"), [agent], translate, "needs-me")).toBeNull();
  });

  it("stays quiet at the nothing level, for disabled agents, stopped turns, and unrelated events", () => {
    expect(notificationForAgentEvent(prompt, [agent], translate, "nothing")).toBeNull();
    expect(
      notificationForAgentEvent(completed("completed"), [{ ...agent, notifications: false }], translate, "all"),
    ).toBeNull();
    expect(notificationForAgentEvent(completed("interrupted"), [agent], translate, "all")).toBeNull();
    expect(notificationForAgentEvent({ type: "agents-changed", agents: [] }, [agent], translate, "all")).toBeNull();
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
