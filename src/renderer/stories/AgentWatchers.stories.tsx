import type { Watcher, WatcherMatch } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { expect, fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentWatchersSettings } from "../src/features/conversation/AgentWatchersSettings";
import { agentWatchersPort } from "../src/features/conversation/watchers-port";
import { createMockOpenBot } from "./mock-openbot";

const priceWatch: Watcher = {
  id: "watcher-price",
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

const pausedFeed: Watcher = {
  ...priceWatch,
  id: "watcher-feed",
  name: "News feed watch",
  active: false,
  intervalMinutes: 30,
  source: { kind: "gmail", query: "subject:invoice" },
  health: "weak",
};

const priceMatch: WatcherMatch = {
  id: "match-1",
  watcherId: "watcher-price",
  agentId: "chief",
  sourceId: "v2:def",
  summary: "Page text: https://example.com/item",
  diff: "- £51.77\n+ £43.21",
  createdAt: "2026-09-01T10:05:00.000Z",
  consumedRunId: "run-1",
};

function WatchersStory(props: { watchers?: Watcher[]; matches?: WatcherMatch[] }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({
    watchers: { chief: props.watchers ?? [priceWatch, pausedFeed] },
    watcherMatches: { "watcher-price": props.matches ?? [priceMatch] },
  });
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <main style={{ width: "380px", height: "720px", overflow: "auto", background: "var(--openbot-bg-canvas)" }}>
      <AgentWatchersSettings port={agentWatchersPort("chief")} onCountChange={fn()} onBack={fn()} onClose={fn()} />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Watchers",
  component: AgentWatchersSettings,
  args: { port: agentWatchersPort("chief"), onCountChange: fn() },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof AgentWatchersSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WatcherList: Story = {
  render: () => <WatchersStory />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("button", { name: /Price watch/ })).toBeVisible();
    await expect(canvas.getByText("15 min · example.com")).toBeVisible();
  },
};

export const WatcherDetail: Story = {
  render: () => <WatchersStory />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Price watch/ }));
    await expect(canvas.getByRole("heading", { name: "Watcher" })).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Watcher active" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Test now" })).toBeEnabled();
    await expect(canvas.getByText("Page text: https://example.com/item")).toBeVisible();
  },
};

export const EmptyWatchers: Story = {
  render: () => <WatchersStory watchers={[]} />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("No watchers yet.")).toBeVisible();
  },
};
