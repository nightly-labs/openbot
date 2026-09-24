import type { AgentMemory } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const storyAgent = STORY_AGENT;

const chiefMemories: AgentMemory[] = [
  {
    id: "memory-automatic",
    agentId: "chief",
    text: "The user prefers short progress updates with the result first.",
    origin: "automatic",
    sourceTurnId: "turn-42",
    createdAt: "2026-08-22T09:15:00.000Z",
    updatedAt: "2026-08-24T14:30:00.000Z",
  },
  {
    id: "memory-manual",
    agentId: "chief",
    text: "Use Bun for package scripts in OpenBot.",
    origin: "manual",
    sourceTurnId: null,
    createdAt: "2026-08-23T11:00:00.000Z",
    updatedAt: "2026-08-23T11:00:00.000Z",
  },
  {
    id: "memory-decision",
    agentId: "chief",
    text: "Keep capabilities and group coordination outside memory version 1.",
    origin: "automatic",
    sourceTurnId: "turn-57",
    createdAt: "2026-08-24T16:20:00.000Z",
    updatedAt: "2026-08-24T16:20:00.000Z",
  },
];

const fullMemoryList: AgentMemory[] = Array.from({ length: 64 }, (_, index) => ({
  id: `memory-${index + 1}`,
  agentId: "chief",
  text: `Durable working preference ${index + 1}: keep the result clear and concise.`,
  origin: index % 3 === 0 ? "manual" : "automatic",
  sourceTurnId: index % 3 === 0 ? null : `turn-${index + 1}`,
  createdAt: "2026-08-24T14:30:00.000Z",
  updatedAt: "2026-08-24T14:30:00.000Z",
}));

function AgentMemoriesStory(props: { memories: AgentMemory[] }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ memories: { chief: props.memories } });
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
        onUpdateRuntimeSettings={async (agentId, _settings, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
          return true;
        }}
        onSetAgentAvatar={async (agentId, image) => {
          await mock.api.agent.setAvatar({ agentId, image });
        }}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Memories",
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
  render: () => <AgentMemoriesStory memories={chiefMemories} />,
};

export const FullList: Story = {
  render: () => <AgentMemoriesStory memories={fullMemoryList} />,
};

export const EmptyState: Story = {
  render: () => <AgentMemoriesStory memories={[]} />,
};
