import { type AgentFolderList, type BrowserProfileSummary, nextBrowserProfileHue } from "@openbot/contracts/ipc";
import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";

const meta = {
  title: "Settings/Shared Agent Form",
  component: AgentSettingsPanel,
  args: {
    agent: STORY_AGENT,
    runtimeSettings: storyRuntimeSettings(STORY_AGENT),
    agentStatus: STORY_AGENT_STATUS,
    modelOptions: STORY_MODELS,
    working: false,
    autoApprove: true,
    onUpdatePermissions: fn(async () => undefined),
    busyMessageModeEditable: true,
    newChatEditable: true,
    quickAcknowledgementEditable: true,
    browserProfiles: {
      profiles: [
        { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215 },
        { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30 },
      ],
      onChange: fn(async () => undefined),
      onCreate: fn(async () => "1b2c3d4e5f60718293a4b5c6d7e8f90a"),
      onManage: fn(),
    },
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
/** The user's own level of the agent. The row opens the notification settings, the one place that changes it. */
export const NotificationLevel: Story = {
  args: { notificationLevel: { current: null, serverLevel: "needs-me", onOpen: fn() } },
};
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENT, access: "workspace" } } };

const STORY_FOLDERS: AgentFolderList = {
  workspace: "/Users/sam/OpenBot/Agents/Chief",
  shared: "/Users/sam/OpenBot/Shared",
  folders: [
    { path: "/Users/sam/Projects/Leads", found: true },
    { path: "/Users/sam/Documents/Contracts 2026", found: false },
  ],
  excluded: ["/Users/sam/Projects/Leads/Clients/Private", "/Users/sam/OpenBot/Agents/Chief/archive"],
};

function storyFolderCalls(): AgentFolderCalls {
  const change = async () => ({ outcome: "cancelled", list: STORY_FOLDERS }) as const;
  return {
    list: async () => STORY_FOLDERS,
    choose: change,
    add: change,
    remove: change,
    drop: change,
    exclude: change,
    addExclusion: change,
    include: change,
  };
}

/**
 * Two added folders; one was moved, so the row and the Folders page say that it is not found. Two
 * folders in them are excluded.
 */
export const WorkspaceOnlyFolders: Story = {
  args: {
    agent: {
      ...STORY_AGENT,
      access: "workspace",
      additionalFolders: STORY_FOLDERS.folders.map((folder) => folder.path),
    },
    folders: storyFolderCalls(),
  },
};
/** Full reach, but the agent asks before it acts. */
export const AskFirst: Story = { args: { agent: { ...STORY_AGENT, access: "full" }, autoApprove: false } };
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
export const RemoteAgent: Story = {
  args: {
    onUpdatePermissions: undefined,
    busyMessageModeEditable: false,
    newChatEditable: false,
    quickAcknowledgementEditable: false,
    browserProfiles: undefined,
  },
};
/**
 * Advanced, then Browser profile, then New profile: the name field opens in the list. Add makes the
 * profile and gives it to the agent. "Client A" is taken.
 */
export const NewBrowserProfile: Story = {
  render: (args) => {
    const [profiles, setProfiles] = createStore<{ list: Pick<BrowserProfileSummary, "id" | "name" | "hue">[] }>({
      list: [
        { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215 },
        { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30 },
      ],
    });
    return (
      <main class="agent-memories-story-stage">
        <AgentSettingsPanel
          {...args}
          browserProfiles={{
            profiles: profiles.list,
            onChange: fn(async () => undefined),
            onCreate: async (name) => {
              if (profiles.list.some((profile) => profile.name.toLowerCase() === name.toLowerCase()))
                throw new Error("A profile with this name already exists.");
              const id = crypto.randomUUID().replaceAll("-", "");
              setProfiles((draft) => {
                draft.list.push({ id, name, hue: nextBrowserProfileHue(draft.list.map((profile) => profile.hue)) });
              });
              return id;
            },
            onManage: fn(),
          }}
        />
      </main>
    );
  },
};
/** An OpenCode model with no reasoning setting: OpenCode decides, and the row says so. */
export const ReasoningSetByProvider: Story = {
  args: {
    runtimeSettings: { provider: "opencode", model: "opencode/big-pickle", reasoningEffort: "medium" },
    modelOptions: [
      ...STORY_MODELS,
      {
        provider: "opencode",
        id: "opencode/big-pickle",
        name: "Big Pickle",
        description: "Free OpenCode model.",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["medium"],
        reasoningEffortConfigurable: false,
      },
    ],
  },
};
export const SaveFailure: Story = {
  args: {
    onUpdateAgent: fn(async () => {
      throw new Error("Could not save agent settings. Try again.");
    }),
  },
};
