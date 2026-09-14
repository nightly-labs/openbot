import { createWorkspacePreferences } from "@openbot/team-client";
import { describe, expect, it } from "vitest";
import { canToggleAgentPin, reconcileAgentPins, reconcileChannelPins, setChannelHidden } from "./agent-pins";

describe("mobile agent pin capacity", () => {
  it("allows the sixteenth pin and rejects a seventeenth pin", () => {
    const pinned = Array.from({ length: 15 }, (_, index) => `agent-${index}`);
    expect(canToggleAgentPin(pinned, "agent-15")).toBe(true);
    pinned.push("agent-15");
    expect(canToggleAgentPin(pinned, "agent-16")).toBe(false);
  });

  it("allows unpinning at or above capacity and pinning after a slot is freed", () => {
    const pinned = Array.from({ length: 17 }, (_, index) => `agent-${index}`);
    expect(canToggleAgentPin(pinned, "agent-0")).toBe(true);
    expect(canToggleAgentPin(pinned, "agent-17")).toBe(false);
    expect(canToggleAgentPin(pinned.slice(2), "agent-17")).toBe(true);
  });
});

it("frees deleted pin slots from complete server lists and keeps the result after restart", () => {
  const values = new Map<string, string>();
  const storage = {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const open = () => createWorkspacePreferences("https://api.example.test", "alice", storage);
  const pinned = Array.from({ length: 16 }, (_, index) => `agent-${index}`);
  const saved = { hidden: ["agent-1"], pinned };
  open().write("server-a", saved);
  open().write("server-b", saved);
  const remaining = pinned.slice(1).map((id) => ({ id }));
  const next = reconcileAgentPins(open(), "server-a", remaining);
  expect(next).toEqual({ hidden: saved.hidden, pinned: pinned.slice(1) });
  expect(canToggleAgentPin(next.pinned, "new-agent")).toBe(true);
  expect(open().read("server-a")).toEqual(next);
  expect(open().read("server-b")).toEqual(saved);
  reconcileAgentPins(open(), "server-a", []);
  expect(open().read("server-a")).toEqual({ hidden: saved.hidden, pinned: [] });
});

it("keeps saved pins when cleanup cannot be written and skips writes for unchanged lists", () => {
  const saved = { hidden: [], pinned: ["agent-1"] };
  const store = {
    read: () => saved,
    write: () => {
      throw new Error("Storage full");
    },
  };
  expect(reconcileAgentPins(store, "server", [{ id: "agent-1" }])).toEqual(saved);
  expect(() => reconcileAgentPins(store, "server", [])).toThrow("Storage full");
  expect(saved.pinned).toEqual(["agent-1"]);
});

it("keeps agent and channel pins independent during cleanup and shares the pin limit", () => {
  const saved = { hidden: ["agent-hidden"], pinned: ["agent-one"], pinnedChannels: ["channel-one", "channel-deleted"] };
  const values = new Map<string, string>();
  const store = createWorkspacePreferences("https://api.example.test", "alice", {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
  });
  store.write("server", saved);
  reconcileAgentPins(store, "server", []);
  expect(store.read("server").pinnedChannels).toEqual(saved.pinnedChannels);
  reconcileChannelPins(store, "server", [{ id: "channel-one" }]);
  expect(store.read("server")).toEqual({ hidden: ["agent-hidden"], pinned: [], pinnedChannels: ["channel-one"] });
  const full = [...Array.from({ length: 15 }, (_, index) => `agent-${index}`), "channel-one"];
  expect(canToggleAgentPin(full, "channel-two")).toBe(false);
  expect(canToggleAgentPin(full, "channel-one")).toBe(true);
});

it("hides and restores channels without changing agent preferences or restoring a pin", () => {
  const values = new Map<string, string>();
  const open = () =>
    createWorkspacePreferences("https://api.example.test", "alice", {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => {
        values.set(key, value);
      },
    });
  const original = { hidden: ["agent-hidden"], pinned: ["agent-one"], pinnedChannels: ["channel-one", "channel-two"] };
  open().write("host", original);
  open().write("other-host", original);
  open().write("host", setChannelHidden(open().read("host"), "channel-one", true));
  expect(open().read("host")).toEqual({
    ...original,
    pinnedChannels: ["channel-two"],
    hiddenChannels: ["channel-one"],
  });
  open().write("host", setChannelHidden(open().read("host"), "channel-one", false));
  expect(open().read("host")).toEqual({ ...original, pinnedChannels: ["channel-two"], hiddenChannels: [] });
  expect(open().read("other-host")).toEqual(original);
});
