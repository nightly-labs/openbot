import type { SharedTable } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS, STORY_SHARED_TABLES } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgent = STORY_AGENT;

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
};

export const EmptyState: Story = {
  render: () => <SharedTablesStory tables={[]} />,
};
