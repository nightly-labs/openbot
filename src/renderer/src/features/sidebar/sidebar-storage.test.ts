import { normalizeSidebarPinnedItems, reownSidebarPinnedItems } from "@openbot/ui/features/sidebar/sidebar-pins";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeSidebarPeopleOrder,
  readSidebarPeopleOrder,
  SIDEBAR_PEOPLE_ORDER_STORAGE_KEY,
  writeSidebarPeopleOrder,
} from "./sidebar-people-order";
import { readSidebarPins, SIDEBAR_PINS_STORAGE_KEY, writeSidebarPins } from "./sidebar-pins-storage";
import { readSidebarCollapsed, SIDEBAR_COLLAPSED_STORAGE_KEY, writeSidebarCollapsed } from "./sidebar-sections-storage";

describe("sidebar collapsed sections", () => {
  it("reads separate server lists and removes duplicates and invalid values", () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          local: ["people", "demo", "demo", null, ""],
          team: ["unassigned"],
          empty: [null],
        }),
      ),
      setItem: vi.fn(),
    };

    expect(readSidebarCollapsed(storage)).toEqual({
      local: ["people", "demo"],
      team: ["unassigned"],
    });
  });

  it("returns an empty map for damaged storage", () => {
    expect(readSidebarCollapsed({ getItem: () => "not-json", setItem: vi.fn() })).toEqual({});
  });

  it("writes the versioned preference without blocking on storage errors", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const collapsed = { local: ["people"], team: ["demo"] };
    writeSidebarCollapsed(collapsed, storage);
    expect(storage.setItem).toHaveBeenCalledWith(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));

    expect(() =>
      writeSidebarCollapsed(collapsed, {
        getItem: vi.fn(),
        setItem: () => {
          throw new Error("full");
        },
      }),
    ).not.toThrow();
  });
});

describe("sidebar people order", () => {
  it("normalizes duplicate and empty member IDs", () => {
    expect(normalizeSidebarPeopleOrder([" alice ", "", "bob", "alice"])).toEqual(["alice", "bob"]);
  });

  it("reads separate server orders and ignores damaged storage", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ local: ["alice", "alice", null], team: ["bob"] })),
      setItem: vi.fn(),
    };
    expect(readSidebarPeopleOrder(storage)).toEqual({ local: ["alice"], team: ["bob"] });
    expect(readSidebarPeopleOrder({ getItem: () => "not-json", setItem: vi.fn() })).toEqual({});
  });

  it("writes without blocking when storage is unavailable", () => {
    const order = { local: ["alice", "bob"] };
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    writeSidebarPeopleOrder(order, storage);
    expect(storage.setItem).toHaveBeenCalledWith(SIDEBAR_PEOPLE_ORDER_STORAGE_KEY, JSON.stringify(order));
    expect(() =>
      writeSidebarPeopleOrder(order, {
        getItem: vi.fn(),
        setItem: () => {
          throw new Error("full");
        },
      }),
    ).not.toThrow();
  });
});

describe("sidebar pins", () => {
  it("keeps unique chats of both kinds and removes legacy person pins", () => {
    expect(
      normalizeSidebarPinnedItems([
        { kind: "agent", id: "chief" },
        { kind: "channel", id: "channel-1" },
        { kind: "person", id: "member-alice" },
        { kind: "agent", id: "chief" },
      ]),
    ).toEqual([
      { kind: "agent", id: "chief" },
      { kind: "channel", id: "channel-1" },
    ]);
  });

  it("repins an agent migration v13 renamed instead of stranding it", () => {
    const uuid = "6d3e8b17-9c04-4f21-8a55-1b2c3d4e5f60";
    const items = [
      { kind: "agent" as const, id: `bot-${uuid}` },
      { kind: "agent" as const, id: "chief" },
    ];

    // These pins live in browser storage, which the id migration never touched, so a pinned agent looks
    // deleted after the upgrade: it disappears from the pinned group while remaining in saved pins.
    expect(reownSidebarPinnedItems(items, new Set([`agent-${uuid}`, "chief"]))).toEqual([
      { kind: "agent", id: `agent-${uuid}` },
      { kind: "agent", id: "chief" },
    ]);

    // v13 declines to rename onto an id that is taken, so the agent that literally holds the old spelling
    // keeps this pin; and a pin matching nobody is left alone, because an agent can be absent for reasons
    // that have nothing to do with the rename.
    expect(reownSidebarPinnedItems(items, new Set([`agent-${uuid}`, `bot-${uuid}`]))).toEqual(items);
    expect(reownSidebarPinnedItems(items, new Set(["chief"]))).toEqual(items);

    // Both spellings can be pinned at once -- the user pinned the agent before the upgrade and its twin
    // after it -- and once the twin is gone they name one agent. Storing it twice shows it twice.
    expect(
      reownSidebarPinnedItems([...items, { kind: "agent", id: `agent-${uuid}` }], new Set([`agent-${uuid}`])),
    ).toEqual([
      { kind: "agent", id: `agent-${uuid}` },
      { kind: "agent", id: "chief" },
    ]);
  });

  it("preserves every pinned agent when saving and restoring more than six", () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      kind: "agent" as const,
      id: `agent-${index}`,
    }));

    expect(normalizeSidebarPinnedItems(items)).toEqual(items);
    let saved = "";
    const storage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => {
        saved = value;
      },
    };
    writeSidebarPins({ local: items }, storage);
    expect(readSidebarPins(storage)).toEqual({ local: items });
  });

  it("reads separate server lists and ignores invalid entries", () => {
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          local: [
            { kind: "agent", id: "chief" },
            { kind: "channel", id: "general" },
          ],
          team: [{ kind: "person", id: "member-alice" }],
          empty: [{ kind: "person", id: "" }],
        }),
      ),
      setItem: vi.fn(),
    };

    expect(readSidebarPins(storage)).toEqual({
      local: [
        { kind: "agent", id: "chief" },
        { kind: "channel", id: "general" },
      ],
    });
  });

  it("returns an empty map for damaged storage", () => {
    expect(readSidebarPins({ getItem: () => "not-json", setItem: vi.fn() })).toEqual({});
  });

  it("writes the versioned preference without throwing on storage errors", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const pins = { local: [{ kind: "agent" as const, id: "chief" }] };
    writeSidebarPins(pins, storage);
    expect(storage.setItem).toHaveBeenCalledWith(SIDEBAR_PINS_STORAGE_KEY, JSON.stringify(pins));

    expect(() =>
      writeSidebarPins(pins, {
        getItem: vi.fn(),
        setItem: () => {
          throw new Error("full");
        },
      }),
    ).not.toThrow();
  });
});
