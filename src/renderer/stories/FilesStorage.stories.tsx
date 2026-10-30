import { SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { AgentFilesView, agentFilesLinkValue } from "@openbot/ui/features/files/AgentFilesView";
import { ConversationFilesPanel } from "@openbot/ui/features/files/ConversationFilesPanel";
import { FileList } from "@openbot/ui/features/files/FileList";
import { StorageOverview } from "@openbot/ui/features/files/StorageOverview";
import { createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
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
  FILES_REMOVABLE_RUNTIMES,
  FILES_ROWS,
  FILES_STATUS_ROWS,
} from "./files-fixtures";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";
import { ServerSettingsStory, STORY_REMOTE_SERVER, serverSettingsArgs } from "./server-settings-story";

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
  runtimeBytes: FILES_REMOVABLE_RUNTIMES.bytes,
  runtimeProviders: FILES_REMOVABLE_RUNTIMES.providers,
  onRemoveRuntimes: fn(async () => undefined),
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
};

// A member of a remote server reads the same page, without Clean up and without Delete.
export const StorageMember: Story = {
  name: "Storage: Member",
  render: () => <OverviewStage args={{ ...overviewArgs(), hostName: "Studio server", canManage: false }} />,
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

const storageArgs = (hostName: string) => ({
  hostName,
  canManage: true,
  onOpenAgent: fn(),
  onShowMessage: fn(),
});

export const StorageInServerSettings: Story = {
  name: "Storage: Server settings, this Mac",
  render: () => (
    <ServerSettingsStory
      settings={{ ...serverSettingsArgs(), storage: storageArgs("This Mac"), initialSection: "storage" }}
    />
  ),
};

export const StorageInRemoteServerSettings: Story = {
  name: "Storage: Server settings, remote server",
  render: () => (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        server: { ...STORY_REMOTE_SERVER, role: "admin" },
        hostStatus: null,
        storage: storageArgs(STORY_REMOTE_SERVER.name),
        initialSection: "storage",
      }}
    />
  ),
};

// Agent settings > Files ---------------------------------------------------

const agentPanelArgs = {
  agent: STORY_AGENT,
  runtimeSettings: storyRuntimeSettings(STORY_AGENT),
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
            agentName={STORY_AGENT.name}
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
};

export const AgentFilesReady: Story = {
  name: "Agent files: Ready",
  render: () => <AgentFilesStory initiallyOpen />,
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
  render: () => <ConversationStage />,
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
};

export const ListLargestFirst: Story = {
  name: "File list: Largest first",
  render: () => <ListStage initialQuery={{ sort: "largest" }} />,
};

export const ListNoMatch: Story = {
  name: "File list: No match",
  render: () => <ListStage initialQuery={{ search: "invoice-2019" }} />,
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
