import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentSettingsScreen } from "../AgentSettingsScreen";
import { NewAgentScreen } from "../NewAgentScreen";
import { NewChannelScreen, NewFolderScreen } from "../NewChatItemScreens";
import { WithWorkspace } from "./story-frame";

const meta = {
  title: "Extension/New and settings",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewAgent: Story = {
  render: () => (
    <WithWorkspace>
      {(workspace) => <NewAgentScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

export const NewChannel: Story = {
  render: () => (
    <WithWorkspace options={{ channels: [] }}>
      {(workspace) => <NewChannelScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

export const NewFolder: Story = {
  render: () => (
    <WithWorkspace options={{ folders: true }}>
      {(workspace) => <NewFolderScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

export const AgentSettings: Story = {
  render: () => (
    <WithWorkspace>
      {(workspace) => (
        <AgentSettingsScreen
          workspace={workspace}
          settings={workspace.settings}
          agentId="chief"
          onClose={() => undefined}
        />
      )}
    </WithWorkspace>
  ),
};
