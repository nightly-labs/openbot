import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Settings/Shared Agent Form",
  component: AgentSettingsPanel,
  args: {
    agent: STORY_AGENTS[0],
    runtimeSettings: {
      provider: STORY_AGENTS[0].provider,
      model: STORY_AGENTS[0].model,
      reasoningEffort: STORY_AGENTS[0].reasoningEffort,
    },
    agentStatus: STORY_AGENT_STATUS,
    modelOptions: STORY_MODELS,
    working: false,
    accessEditable: true,
    width: 296,
    maxWidth: () => 640,
    onClose: fn(),
    onResize: fn(),
    onResizeEnd: fn(),
    onUpdateAgent: fn(async () => undefined),
    onUpdateRuntimeSettings: fn(async () => true),
    onSetAgentAvatar: fn(async () => undefined),
  },
  render: (args) => (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel {...args} />
    </main>
  ),
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Working: Story = { args: { working: true } };
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENTS[0], access: "workspace" } } };
export const SaveFailure: Story = {
  args: {
    onUpdateAgent: fn(async () => {
      throw new Error("Could not save agent settings. Try again.");
    }),
  },
};
