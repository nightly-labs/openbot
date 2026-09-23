import type { SharedTable } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { expect, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS, STORY_SHARED_TABLES } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

function requireStoryAgent() {
  const [agent] = STORY_AGENTS;
  if (!agent) throw new Error("The story fixtures have no agent.");
  return agent;
}

const storyAgent = requireStoryAgent();

function SharedTablesStory(props: { tables: SharedTable[] }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ tables: props.tables });
  window.openbot = mock.api;

  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });

  return (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel
        onOpenUsage={fn()}
        agent={storyAgent}
        agents={STORY_AGENTS}
        runtimeSettings={{
          provider: storyAgent.provider,
          model: storyAgent.model,
          reasoningEffort: storyAgent.reasoningEffort,
        }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={fn()}
        onWidthChange={fn()}
        onUpdateAgent={async (agentId, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
        }}
        onUpdateRuntimeSettings={async () => true}
        onSetAgentAvatar={async (agentId, image) => {
          await mock.api.agent.setAvatar({ agentId, image });
        }}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Tables",
  component: AgentSettingsPanel,
  args: {
    agent: storyAgent,
    runtimeSettings: {
      provider: storyAgent.provider,
      model: storyAgent.model,
      reasoningEffort: storyAgent.reasoningEffort,
    },
    agentStatus: STORY_AGENT_STATUS,
    modelOptions: STORY_MODELS,
    working: false,
    maxWidth: () => 640,
    onClose: fn(),
    onWidthChange: fn(),
    onUpdateAgent: fn(async () => undefined),
    onUpdateRuntimeSettings: fn(async () => true),
    onSetAgentAvatar: fn(async () => undefined),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SettingsRow: Story = {
  render: () => <SharedTablesStory tables={STORY_SHARED_TABLES} />,
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getByRole("button", { name: /Tables/ })).toHaveTextContent("6 tables"));
  },
};

export const OpenModal: Story = {
  render: () => <SharedTablesStory tables={STORY_SHARED_TABLES} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Tables/ }));
    const body = within(document.body);
    await expect(await body.findByRole("dialog", { name: "Tables" })).toBeVisible();
    await expect(body.getByText("people")).toBeVisible();
    await expect(body.getByText(`214 records · Kept by ${storyAgent.name}`)).toBeVisible();
    await expect(body.getByText(/not counted · Made outside OpenBot/)).toBeVisible();
  },
};

export const DeleteConfirmation: Story = {
  render: () => <SharedTablesStory tables={STORY_SHARED_TABLES} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Tables/ }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Delete people" }));
    await expect(await body.findByText("Delete this for every agent?", { exact: false })).toBeVisible();
  },
};

export const EmptyState: Story = {
  render: () => <SharedTablesStory tables={[]} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Tables/ }));
    const body = within(document.body);
    await expect(await body.findByText("No tables yet", { exact: false })).toBeVisible();
  },
};
