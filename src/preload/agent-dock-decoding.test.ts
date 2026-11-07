// @vitest-environment node

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_DOCK_LIMITS, type AgentDockPresentation } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeAgentDockAction,
  decodeAgentDockDisplays,
  decodeAgentDockOffset,
  decodeAgentDockPresentation,
} from "./agent-dock-decoding";

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarColor: null,
  avatarUrl: null,
};

const RESULT = { id: "message-1", agentId: "agent-1", kind: "message", label: "Done.", at: 1_762_500_000_000 } as const;

const PRESENTATION: AgentDockPresentation = {
  serverId: "local",
  display: { kind: "display", id: 69733382 },
  edge: "left",
  autoHide: true,
  offsets: [{ displayId: 69733382, offset: 0 }],
  seats: [{ agent: AGENT, mood: "working", state: { kind: "unread", count: 2 } }],
  available: [],
  agents: [AGENT],
  chats: [
    {
      agentId: "agent-1",
      messages: [{ id: "message-1", author: "agent", kind: "text", body: "Done.", attachments: [] }],
      working: false,
      wait: null,
    },
  ],
  results: [RESULT],
};

describe("agent dock decoding", () => {
  it("accepts a presentation and null", () => {
    expect(decodeAgentDockPresentation(PRESENTATION)).toEqual(PRESENTATION);
    expect(decodeAgentDockPresentation(null)).toBeNull();
    const all: AgentDockPresentation = { ...PRESENTATION, display: { kind: "all" } };
    expect(decodeAgentDockPresentation(all)).toEqual(all);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, display: { kind: "each" } })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("rejects a presentation over its limits", () => {
    const seats = Array.from({ length: AGENT_DOCK_LIMITS.seats + 1 }, () => PRESENTATION.seats[0]);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, seats })).toThrow("Invalid agent dock presentation.");
    const badCount = [{ agent: AGENT, mood: "idle", state: { kind: "unread", count: AGENT_DOCK_LIMITS.count + 1 } }];
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, seats: badCount })).toThrow(
      "Invalid agent dock presentation.",
    );
    const longName = { ...AGENT, name: "a".repeat(INPUT_LIMITS.agentName + 1) };
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, agents: [longName] })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("rejects a finished result that is too long, empty or of an unknown kind", () => {
    const results = Array.from({ length: AGENT_DOCK_LIMITS.results + 1 }, () => RESULT);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, results })).toThrow("Invalid agent dock presentation.");
    for (const bad of [
      { ...RESULT, label: "a".repeat(AGENT_DOCK_LIMITS.resultLabel + 1) },
      { ...RESULT, label: "" },
      { ...RESULT, kind: "event" },
      { ...RESULT, at: -1 },
    ]) {
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, results: [bad] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
    const { results: _missing, ...withoutResults } = PRESENTATION;
    expect(() => decodeAgentDockPresentation(withoutResults)).toThrow("Invalid agent dock presentation.");
  });

  it("accepts a dock position and rejects one outside the display", () => {
    expect(decodeAgentDockOffset({ displayId: 1, offset: 1 })).toEqual({ displayId: 1, offset: 1 });
    expect(decodeAgentDockOffset({ displayId: 1, offset: 0 })).toEqual({ displayId: 1, offset: 0 });
    for (const value of [
      { displayId: 1, offset: -0.1 },
      { displayId: 1, offset: 1.1 },
      { displayId: 1, offset: Number.POSITIVE_INFINITY },
      { displayId: 1.5, offset: 0.5 },
      { displayId: 1 },
      null,
    ]) {
      expect(() => decodeAgentDockOffset(value)).toThrow("Invalid agent dock position.");
    }
  });

  it("accepts the display list and rejects a wrong or long one", () => {
    const display = { id: 1, label: "Built-in Retina Display", primary: true, internal: true };
    expect(decodeAgentDockDisplays([display])).toEqual([display]);
    expect(decodeAgentDockDisplays([])).toEqual([]);
    const many = Array.from({ length: AGENT_DOCK_LIMITS.displays + 1 }, () => display);
    expect(() => decodeAgentDockDisplays(many)).toThrow("Invalid agent dock display list.");
    expect(() => decodeAgentDockDisplays([{ ...display, id: 1.5 }])).toThrow("Invalid agent dock display list.");
    expect(() =>
      decodeAgentDockDisplays([{ ...display, label: "a".repeat(AGENT_DOCK_LIMITS.displayLabel + 1) }]),
    ).toThrow("Invalid agent dock display list.");
    expect(() => decodeAgentDockDisplays(null)).toThrow("Invalid agent dock display list.");
  });

  it("accepts the actions that main forwards and rejects others", () => {
    const action = { type: "open-chat", serverId: "local", agentId: null };
    expect(decodeAgentDockAction(action)).toEqual(action);
    expect(decodeAgentDockAction({ type: "open-link", url: "https://example.com" })).toEqual({
      type: "open-link",
      url: "https://example.com",
    });
    expect(decodeAgentDockAction({ type: "open-settings" })).toEqual({ type: "open-settings" });
    expect(decodeAgentDockAction({ type: "open-window", serverId: "local", agentId: "agent-1" })).toEqual({
      type: "open-window",
      serverId: "local",
      agentId: "agent-1",
    });
    expect(() => decodeAgentDockAction({ type: "open-window", serverId: "local", agentId: "" })).toThrow(
      "Invalid agent dock action.",
    );
    expect(() => decodeAgentDockAction({ type: "open-link", url: "" })).toThrow("Invalid agent dock action.");
    expect(() => decodeAgentDockAction({ type: "add", serverId: "", agentId: "agent-1" })).toThrow(
      "Invalid agent dock action.",
    );
    expect(() => decodeAgentDockAction({ type: "run", serverId: "local" })).toThrow("Invalid agent dock action.");
  });
});
