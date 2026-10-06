import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Settings/Shared Agent Form",
  component: AgentSettingsPanel,
  args: {
    agent: STORY_AGENT,
    runtimeSettings: {
      provider: STORY_AGENT.provider,
      model: STORY_AGENT.model,
      reasoningEffort: STORY_AGENT.reasoningEffort,
    },
    agentStatus: STORY_AGENT_STATUS,
    modelOptions: STORY_MODELS,
    working: false,
    accessEditable: true,
    busyMessageModeEditable: true,
    defaultBusyMessageMode: "queue",
    width: 296,
    maxWidth: () => 640,
    onClose: fn(),
    onStartNewChat: fn(async () => {}),
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
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENT, access: "workspace" } } };
/** The agent steers messages sent while it works, whatever the app default says. */
export const SteersWhileWorking: Story = { args: { agent: { ...STORY_AGENT, busyMessageMode: "steer" } } };
/** Steer, from the app default, on a provider that cannot steer: the note says the messages queue. */
export const SteerUnsupportedProvider: Story = {
  args: {
    defaultBusyMessageMode: "steer",
    runtimeSettings: { provider: "opencode", model: STORY_AGENT.model, reasoningEffort: STORY_AGENT.reasoningEffort },
  },
};
/** An agent on a remote host: the setting belongs to that host, so the row is hidden. */
export const RemoteAgent: Story = { args: { accessEditable: false, busyMessageModeEditable: false } };
export const SaveFailure: Story = {
  args: {
    onUpdateAgent: fn(async () => {
      throw new Error("Could not save agent settings. Try again.");
    }),
  },
};
