import type { Watcher, WatcherMatch } from "@openbot/contracts/ipc";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockOpenBot, type MockOpenBotControls } from "../../preview/mock-openbot";
import { AgentWatchersSettings } from "./AgentWatchersSettings";
import { agentWatchersPort } from "./watchers-port";

const watcher: Watcher = {
  id: "watcher-1",
  agentId: "chief",
  routineId: "routine-1",
  name: "Price watch",
  active: true,
  intervalMinutes: 15,
  source: { kind: "web", url: "https://example.com/item" },
  selector: { textAnchor: "In stock" },
  condition: {},
  health: "ok",
  lastCheckedAt: "2026-09-01T10:00:00.000Z",
  nextCheckAt: "2026-09-01T10:15:00.000Z",
  lastStateHash: "v2:abc",
  lastKeptText: "Price is steady today.",
  lastMode: "fetch",
  errorCount: 0,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-01T09:00:00.000Z",
};

const match: WatcherMatch = {
  id: "match-1",
  watcherId: "watcher-1",
  agentId: "chief",
  sourceId: "v2:def",
  summary: "Page text: https://example.com/item",
  diff: "- £51.77\n+ £43.21",
  createdAt: "2026-09-01T10:05:00.000Z",
  consumedRunId: "run-1",
};

let mock: MockOpenBotControls | undefined;

function setupOpenBot(options?: Parameters<typeof createMockOpenBot>[0]): MockOpenBotControls {
  mock?.dispose();
  mock = createMockOpenBot(options);
  window.openbot = mock.api;
  return mock;
}

afterEach(() => {
  mock?.dispose();
  mock = undefined;
  vi.restoreAllMocks();
});

describe("AgentWatchersSettings", () => {
  it("lists watchers with source summaries and reports the count", async () => {
    const onCountChange = vi.fn();
    setupOpenBot({
      watchers: { chief: [watcher, { ...watcher, id: "watcher-2", name: "Paused feed", active: false }] },
    });
    render(() => <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={onCountChange} />);

    expect(await screen.findByRole("button", { name: /Price watch/ })).toBeInTheDocument();
    expect(screen.getByText("15 min · example.com")).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(2));
  });

  it("shows an empty state with no watchers", async () => {
    setupOpenBot();
    render(() => <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={vi.fn()} />);

    expect(await screen.findByText("No watchers yet.")).toBeInTheDocument();
  });

  it("opens detail, pauses through the switch, and shows matches", async () => {
    const controls = setupOpenBot({ watchers: { chief: [watcher] }, watcherMatches: { "watcher-1": [match] } });
    const updateWatcher = vi.spyOn(controls.api.agent, "updateWatcher");
    render(() => <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={vi.fn()} />);

    await fireEvent.click(await screen.findByRole("button", { name: /Price watch/ }));
    expect(await screen.findByText("Every 15 minutes")).toBeInTheDocument();
    expect(screen.getByText("Page text: https://example.com/item")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("switch", { name: "Watcher active" }));
    await waitFor(() =>
      expect(updateWatcher).toHaveBeenCalledWith({ agentId: "chief", watcherId: "watcher-1", active: false }),
    );
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("runs a test check and deletes with confirm", async () => {
    const controls = setupOpenBot({ watchers: { chief: [watcher] } });
    const testWatcher = vi.spyOn(controls.api.agent, "testWatcher");
    render(() => <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={vi.fn()} />);

    await fireEvent.click(await screen.findByRole("button", { name: /Price watch/ }));
    await fireEvent.click(await screen.findByRole("button", { name: "Test now" }));
    await waitFor(() => expect(testWatcher).toHaveBeenCalledWith({ agentId: "chief", watcherId: "watcher-1" }));

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await fireEvent.click(await screen.findByRole("button", { name: "Delete now" }));
    expect(await screen.findByText("No watchers yet.")).toBeInTheDocument();
  });

  it("shows backend errors in the alert row", async () => {
    const controls = setupOpenBot({ watchers: { chief: [watcher] } });
    vi.spyOn(controls.api.agent, "updateWatcher").mockRejectedValueOnce(new Error("offline"));
    render(() => <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={vi.fn()} />);

    await fireEvent.click(await screen.findByRole("button", { name: /Price watch/ }));
    await fireEvent.click(screen.getByRole("switch", { name: "Watcher active" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
