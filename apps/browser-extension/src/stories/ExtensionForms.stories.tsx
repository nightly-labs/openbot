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

/** The desktop's new-agent form: look, name, purpose and model, and the suggestions under it. */
export const NewAgent: Story = {
  render: () => (
    <WithWorkspace>
      {(workspace) => <NewAgentScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

/** A name and at least one agent; the first agent leads. */
export const NewChannel: Story = {
  render: () => (
    <WithWorkspace options={{ channels: [] }}>
      {(workspace) => <NewChannelScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

/** A name of at most 40 characters. Type "Work" to see the note that the name is taken. */
export const NewFolder: Story = {
  render: () => (
    <WithWorkspace options={{ folders: true }}>
      {(workspace) => <NewFolderScreen workspace={workspace} onClose={() => undefined} onCreated={() => undefined} />}
    </WithWorkspace>
  ),
};

/** The desktop's agent settings panel at the side panel's width. */
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
