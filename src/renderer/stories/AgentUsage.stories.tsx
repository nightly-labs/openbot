import { emptyAnalyticsTotals, type HostAnalytics } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentUsagePanel } from "../src/features/usage/AgentUsagePanel";
import { mockHostAnalytics } from "../src/preview/mock-agent-analytics";
import { createMockOpenBot } from "./mock-openbot";

function UsageStory(props: {
  state: "ready" | "empty" | "partial" | "loading" | "error" | "unsupported" | "large" | "small" | "long";
  narrow?: boolean;
  agentId?: string;
}) {
  const previous = window.openbot;
  const mock = createMockOpenBot();
  window.openbot = mock.api;
  mock.api.agent.getHostAnalytics = async (input) => {
    if (props.state === "error") throw new Error("Host is offline.");
    if (props.state === "unsupported") return null;
    if (props.state === "loading") return new Promise<HostAnalytics>(() => {});
    const data = mockHostAnalytics(input, [
      { id: "chief", provider: "codex", model: "gpt-6-astra" },
      { id: "research", provider: "claude", model: "claude-sonnet-5" },
      { id: "sales-outbound", provider: "grok", model: "grok-4.6" },
    ]);
    const factor = props.state === "large" ? 100_000 : props.state === "small" ? 0.0001 : 1;
    data.totals.estimatedCostUsd = (data.totals.estimatedCostUsd ?? 0) * factor;
    data.daily = data.daily.map((day) => ({
      ...day,
      estimatedCostUsd: day.estimatedCostUsd === null ? null : day.estimatedCostUsd * factor,
    }));
    data.models = data.models.map((model) => ({
      ...model,
      model: props.state === "long" ? `${model.model}-long-context-experimental-model-name` : model.model,
      estimatedCostUsd: model.estimatedCostUsd === null ? null : model.estimatedCostUsd * factor,
    }));
    if (props.state === "empty") return { ...data, totals: emptyAnalyticsTotals(), models: [], daily: [] };
    if (props.state === "partial")
      return { ...data, totals: { ...data.totals, missingUsageTurns: 3, unpricedRecords: 2 } };
    return data;
  };
  onCleanup(() => {
    mock.dispose();
    window.openbot = previous;
  });
  return (
    <main
      style={{
        width: props.narrow ? "390px" : "100%",
        height: "900px",
        overflow: "hidden",
        background: "var(--openbot-bg-canvas)",
      }}
    >
      <AgentUsagePanel hostName="Local host" serverId="local" agentId={props.agentId} onBack={fn()} />
    </main>
  );
}
const meta = {
  title: "Agents/Usage",
  component: UsageStory,
  args: { state: "ready" },
} satisfies Meta<typeof UsageStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Usage: Story = {};
export const Empty: Story = { args: { state: "empty" } };
export const Partial: Story = { args: { state: "partial" } };
export const Loading: Story = { args: { state: "loading" } };
export const ErrorState: Story = { args: { state: "error" } };
export const Unsupported: Story = { args: { state: "unsupported" } };

export const Narrow: Story = { args: { narrow: true } };
export const LargeNumbers: Story = { args: { state: "large" } };
export const SmallCosts: Story = { args: { state: "small" } };
export const LongModelNames: Story = { args: { state: "long", narrow: true } };

export const SingleAgent: Story = { args: { agentId: "chief" } };
