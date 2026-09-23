import { Blocks, HardDrive, Monitor, Settings, Tabs, UsersRound } from "@openbot/ui";
import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { AgentFilesView, agentFilesLinkValue } from "@openbot/ui/features/files/AgentFilesView";
import { ConversationFilesPanel } from "@openbot/ui/features/files/ConversationFilesPanel";
import { FileList } from "@openbot/ui/features/files/FileList";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createSignal, Show } from "solid-js";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  FILES_AGENT_USAGE,
  FILES_AGENTS,
  FILES_BREAKDOWN,
  FILES_BREAKDOWN_LARGE,
  FILES_CHIEF_BREAKDOWN,
  FILES_CHIEF_CONVERSATIONS,
  FILES_CHIEF_ROWS,
  FILES_CONVERSATIONS,
  FILES_LAUNCH_ROWS,
  FILES_LONG_NAME_ROWS,
  FILES_NOW,
  FILES_ROWS,
  FILES_STATUS_ROWS,
} from "./files-fixtures";
import { STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Files/Storage",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Settings > Storage -------------------------------------------------------

type OverviewArgs = Parameters<typeof StorageOverview>[0];

const overviewArgs = (): OverviewArgs => ({
  hostName: "This Mac",
  state: "ready",
  scannedAt: new Date(FILES_NOW.getTime() - 4 * 60_000).toISOString(),
  freeBytes: 182 * 1024 ** 3,
  breakdown: FILES_BREAKDOWN,
  agents: FILES_AGENTS,
  agentUsage: FILES_AGENT_USAGE,
  conversations: FILES_CONVERSATIONS,
  files: FILES_ROWS,
  now: FILES_NOW,
  canManage: true,
  onRescan: fn(),
  onOpenAgent: fn(),
  onOpenConversation: fn(),
  onClear: fn(async () => undefined),
  onPreviewFile: fn(),
  onFileAction: fn(async () => undefined),
});

function OverviewStage(props: { args: OverviewArgs; narrow?: boolean }) {
  return (
    <main class="files-story-stage">
      <div class="files-story-page" data-narrow={props.narrow ? "true" : undefined}>
        <StorageOverview {...props.args} />
      </div>
    </main>
  );
}

export const StorageReady: Story = {
  name: "Storage: Ready",
  render: () => <OverviewStage args={overviewArgs()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("img", { name: /^Storage by type: Agent workspaces 3\.6 GB/u })).toBeVisible();
    await expect(canvas.getByRole("list", { name: "Storage by type" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^All files/u }));
    const all = await canvas.findByRole("region", { name: "All files on This Mac" });
    await expect(within(all).getByRole("heading", { name: "Today" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back to storage" }));
    await expect(await canvas.findByRole("heading", { name: "Largest chats" })).toBeVisible();
  },
};

export const StorageClearConfirm: Story = {
  name: "Storage: Clear confirm",
  render: () => <OverviewStage args={overviewArgs()} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Clear Cached server files" }));
    const body = within(document.body);
    const dialog = await body.findByRole("alertdialog", { name: "Clear cached server files?" });
    // The dialog fades in; wait for the animation to end.
    await waitFor(() => expect(dialog).toBeVisible());
  },
};

// A member of a remote server reads the same page, without Clean up and without Delete.
export const StorageMember: Story = {
  name: "Storage: Member",
  render: () => <OverviewStage args={{ ...overviewArgs(), hostName: "Studio server", canManage: false }} />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("heading", { name: "Clean up" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: /^All files/u }));
    await userEvent.click(await canvas.findByRole("button", { name: "More actions for release-notes-v4.md" }));
    const body = within(document.body);
    await expect(await body.findByRole("menuitem", { name: "Open" })).toBeVisible();
    await expect(body.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
  },
};

export const StorageScanning: Story = {
  name: "Storage: Scanning",
  render: () => (
    <OverviewStage
      args={{
        ...overviewArgs(),
        state: "scanning",
        scanProgress: 42,
        breakdown: FILES_BREAKDOWN.slice(0, 3),
        agentUsage: [],
        conversations: [],
        files: [],
      }}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("progressbar", { name: "Measuring storage" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /Measuring/u })).toBeDisabled();
  },
};

export const StorageEmpty: Story = {
  name: "Storage: Empty",
  render: () => (
    <OverviewStage
      args={{
        ...overviewArgs(),
        breakdown: [],
        agentUsage: [],
        conversations: [],
        files: [],
      }}
    />
  ),
};

export const StorageError: Story = {
  name: "Storage: Error",
  render: () => (
    <OverviewStage
      args={{
        ...overviewArgs(),
        state: "error",
        error: "OpenBot could not read ~/OpenBot/Agents. Check the folder permissions and try again.",
        scannedAt: null,
        breakdown: [],
        agentUsage: [],
        conversations: [],
        files: [],
      }}
    />
  ),
};

export const StorageLarge: Story = {
  name: "Storage: Large server",
  render: () => (
    <OverviewStage
      args={{
        ...overviewArgs(),
        hostName: "studio-server",
        freeBytes: 3.1 * 1024 ** 4,
        breakdown: FILES_BREAKDOWN_LARGE,
        agentUsage: FILES_AGENT_USAGE.map((row) => ({
          ...row,
          bytes: row.bytes * 290,
          fileCount: row.fileCount * 412,
          conversationCount: row.conversationCount * 60,
        })),
      }}
    />
  ),
};

export const StorageNarrow: Story = {
  name: "Storage: Narrow",
  render: () => <OverviewStage args={overviewArgs()} narrow />,
};

// The same sections and icons as the real ServerSettingsModal, with Storage added last.
const SERVER_SETTINGS_NAV = [
  { value: "general", label: "General", icon: Settings },
  { value: "members", label: "Members", icon: UsersRound },
  { value: "desktop", label: "Remote desktop", icon: Monitor },
  { value: "mcp", label: "MCP", icon: Blocks },
  { value: "storage", label: "Storage", icon: HardDrive },
] as const;

function ServerSettingsStage(props: { args: OverviewArgs }) {
  const [tab, setTab] = createSignal("storage");
  return (
    <Tabs.Root value={tab()} onChange={setTab} orientation="vertical" class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="server-settings-modal-shell"
        open
        onOpenChange={() => undefined}
        title="Storage"
        description="See how much disk space this server uses."
        contentKey={tab()}
        closeLabel="Close server settings"
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label="Server settings sections">
            {SERVER_SETTINGS_NAV.map((item) => {
              const NavIcon = item.icon;
              return (
                <Tabs.Trigger class="settings-modal-nav-item" value={item.value}>
                  <NavIcon aria-hidden="true" />
                  <span>{item.label}</span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="storage" class="settings-modal-tab-panel server-settings-panel" data-tab="storage">
          <StorageOverview {...props.args} />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}

export const StorageInServerSettings: Story = {
  name: "Storage: Server settings, this Mac",
  render: () => <ServerSettingsStage args={overviewArgs()} />,
  play: async () => {
    const body = within(document.body);
    const dialog = await body.findByRole("dialog", { name: "Storage" });
    await expect(within(dialog).getByRole("tab", { name: "Storage" })).toHaveAttribute("aria-selected", "true");
    await expect(within(dialog).getByRole("img", { name: /^Storage by type/u })).toBeInTheDocument();
  },
};

export const StorageInRemoteServerSettings: Story = {
  name: "Storage: Server settings, remote server",
  render: () => (
    <ServerSettingsStage
      args={{
        ...overviewArgs(),
        hostName: "studio-server",
        freeBytes: 3.1 * 1024 ** 4,
        breakdown: FILES_BREAKDOWN_LARGE,
      }}
    />
  ),
};

// Agent settings > Files ---------------------------------------------------

const agentPanelArgs = {
  agent: STORY_AGENTS[0],
  runtimeSettings: {
    provider: STORY_AGENTS[0].provider,
    model: STORY_AGENTS[0].model,
    reasoningEffort: STORY_AGENTS[0].reasoningEffort,
  },
  agentStatus: STORY_AGENT_STATUS,
  modelOptions: STORY_MODELS,
  working: false,
  width: 360,
  maxWidth: () => 640,
  onClose: fn(),
  onResize: fn(),
  onResizeEnd: fn(),
  onUpdateAgent: fn(async () => undefined),
  onUpdateRuntimeSettings: fn(async () => true),
  onSetAgentAvatar: fn(async () => undefined),
};

function AgentFilesStory(props: { initiallyOpen: boolean; loading?: boolean; empty?: boolean }) {
  const [open, setOpen] = createSignal(props.initiallyOpen);
  const breakdown = () => (props.empty ? [] : FILES_CHIEF_BREAKDOWN);
  return (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel
        {...agentPanelArgs}
        detailOpen={open()}
        links={
          <SettingsLinkGroup>
            <SettingsLinkRow label="Memories" value="12 saved" onClick={fn()} />
            <SettingsLinkRow label="Skills" value="3 assigned" onClick={fn()} />
            <SettingsLinkRow label="Files" value={agentFilesLinkValue(breakdown())} onClick={() => setOpen(true)} />
            <SettingsLinkRow label="Routines" value="2 configured" onClick={fn()} />
          </SettingsLinkGroup>
        }
      >
        <Show when={open()}>
          <AgentFilesView
            agentName={STORY_AGENTS[0].name}
            loading={props.loading}
            breakdown={breakdown()}
            conversations={props.empty ? [] : FILES_CHIEF_CONVERSATIONS}
            files={props.empty ? [] : FILES_CHIEF_ROWS}
            now={FILES_NOW}
            onBack={() => setOpen(false)}
            onClose={fn()}
            onOpenWorkspace={fn()}
            canDelete
            onOpenConversation={fn()}
            onPreviewFile={fn()}
            onFileAction={fn(async () => undefined)}
          />
        </Show>
      </AgentSettingsPanel>
    </main>
  );
}

export const AgentFilesLink: Story = {
  name: "Agent files: Settings row",
  render: () => <AgentFilesStory initiallyOpen={false} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Files/u }));
    await expect(await canvas.findByRole("region", { name: "Files of Chief" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Back to settings" }));
    await expect(await canvas.findByRole("button", { name: /^Files/u })).toBeVisible();
  },
};

export const AgentFilesReady: Story = {
  name: "Agent files: Ready",
  render: () => <AgentFilesStory initiallyOpen />,
  play: async ({ canvas }) => {
    // The settings detail slides in; wait for the animation to end.
    await waitFor(() => expect(canvas.getByRole("button", { name: "Open workspace folder" })).toBeVisible());
    await expect(canvas.getByRole("heading", { name: "Chats by size" })).toBeVisible();
  },
};

export const AgentFilesEmpty: Story = {
  name: "Agent files: Empty",
  render: () => <AgentFilesStory initiallyOpen empty />,
};

export const AgentFilesLoading: Story = {
  name: "Agent files: Loading",
  render: () => <AgentFilesStory initiallyOpen loading />,
};

// Chat > Files ------------------------------------------------------------

function ConversationStage(props: Partial<Parameters<typeof ConversationFilesPanel>[0]>) {
  return (
    <main class="agent-memories-story-stage files-story-chat">
      <ConversationFilesPanel
        conversationTitle="Launch plan and release notes"
        files={FILES_LAUNCH_ROWS}
        chatBytes={486 * 1024 ** 2}
        width={380}
        now={FILES_NOW}
        canDelete
        onClose={fn()}
        onPreviewFile={fn()}
        onFileAction={fn(async () => undefined)}
        {...props}
      />
    </main>
  );
}

export const ConversationReady: Story = {
  name: "Chat files: Ready",
  render: () => {
    const onFileAction = fn(async () => undefined);
    return <ConversationStage onFileAction={onFileAction} />;
  },
  play: async ({ canvas }) => {
    const panel = canvas.getByRole("complementary", { name: "Files in Launch plan and release notes" });
    await expect(within(panel).getByRole("heading", { name: "Today" })).toBeVisible();
    await userEvent.click(within(panel).getByRole("button", { name: "More actions for release-notes-v4.md" }));
    await expect(await within(document.body).findByRole("menuitem", { name: "Show in chat" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(document.body).queryByRole("menu")).toBeNull());
  },
};

export const ConversationEmpty: Story = {
  name: "Chat files: Empty",
  render: () => <ConversationStage files={[]} chatBytes={2 * 1024 ** 2} />,
};

export const ConversationMissingAndRemote: Story = {
  name: "Chat files: Missing and remote",
  render: () => (
    <ConversationStage
      conversationTitle="Source check for the pricing brief"
      files={FILES_STATUS_ROWS}
      chatBytes={142 * 1024 ** 2}
    />
  ),
};

export const ConversationLongNames: Story = {
  name: "Chat files: Long names",
  render: () => <ConversationStage files={FILES_LONG_NAME_ROWS} width={300} />,
};

// The shared list ----------------------------------------------------------

function ListStage(props: Partial<Parameters<typeof FileList>[0]>) {
  return (
    <main class="files-story-stage">
      <div class="files-story-page">
        <FileList
          label="All files"
          files={FILES_ROWS}
          agents={FILES_AGENTS}
          showConversation
          now={FILES_NOW}
          canDelete
          onPreview={fn()}
          onAction={fn(async () => undefined)}
          {...props}
        />
      </div>
    </main>
  );
}

export const ListFilters: Story = {
  name: "File list: Search and filters",
  render: () => <ListStage />,
  play: async ({ canvas }) => {
    const images = canvas.getByRole("button", { name: /^Images/u });
    await userEvent.click(images);
    await expect(images).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search files" }), "moodboard");
    await expect(canvas.getAllByRole("button", { name: /^Preview moodboard/u })).toHaveLength(3);
  },
};

export const ListLargestFirst: Story = {
  name: "File list: Largest first",
  render: () => <ListStage initialQuery={{ sort: "largest" }} />,
};

export const ListNoMatch: Story = {
  name: "File list: No match",
  render: () => <ListStage initialQuery={{ search: "invoice-2019" }} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No matching files")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByRole("searchbox", { name: "Search files" })).toHaveValue("");
  },
};

export const ListDeleteConfirm: Story = {
  name: "File list: Delete confirm",
  render: () => <ListStage />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More actions for release-notes-v4.md" }));
    const body = within(document.body);
    await userEvent.click(await body.findByRole("menuitem", { name: "Delete" }));
    const dialog = await body.findByRole("alertdialog", { name: "Delete this file?" });
    // The dialog fades in; wait for the animation to end.
    await waitFor(() => expect(dialog).toBeVisible());
  },
};

export const ListLoading: Story = {
  name: "File list: Loading",
  render: () => <ListStage loading />,
};

export const ListError: Story = {
  name: "File list: Error",
  render: () => (
    <ListStage error="The attachment index is not available. Restart OpenBot and try again." onRetry={fn()} />
  ),
};
