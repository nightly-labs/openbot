import { CopyAgentsDialog } from "@openbot/ui/features/transfer/CopyAgentsDialog";
import { InstanceTransferView } from "@openbot/ui/features/transfer/InstanceTransferView";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES, STORY_SERVERS } from "./fixtures";
import {
  INSTANCE_TRANSFER_PREVIEW,
  INSTANCE_TRANSFER_RESULT,
  INSTANCE_TRANSFER_SUMMARY,
  INSTANCE_TRANSFER_WARNINGS,
} from "./instance-transfer-fixtures";
import { MANY_AGENTS } from "./marketplace-story-support";
import { ServerSettingsStory, serverSettingsArgs } from "./server-settings-story";

const meta = {
  title: "Settings/Transfer",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type ViewArgs = Parameters<typeof InstanceTransferView>[0];

const viewArgs = (overrides: Partial<ViewArgs> = {}): ViewArgs => ({
  screen: "home",
  onScreenChange: fn(),
  summary: INSTANCE_TRANSFER_SUMMARY,
  exportPhase: "options",
  exportFileName: null,
  exportWarnings: [],
  exportError: null,
  onExport: fn(),
  onShowExport: fn(),
  onExportAgain: fn(),
  importPhase: "idle",
  preview: null,
  result: null,
  importError: null,
  onChoose: fn(),
  onImport: fn(),
  onCancelImport: fn(),
  onImportDone: fn(),
  onSignIn: fn(),
  ...overrides,
});

/** The view alone. The screen buttons work. */
function Stage(props: { args: ViewArgs }) {
  const [screen, setScreen] = createSignal(props.args.screen);
  return (
    <main class="files-story-stage">
      <div class="files-story-page">
        <InstanceTransferView {...props.args} screen={screen()} onScreenChange={setScreen} />
      </div>
    </main>
  );
}

/** Server settings > Transfer for this computer. The preview exports and imports. */
export const InServerSettings: Story = {
  name: "Server settings",
  render: () => (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        instanceTransfer: { onSignIn: fn(), history: true, fullCopy: true },
        initialSection: "transfer",
      }}
    />
  ),
};

export const Home: Story = { name: "Which computer", render: () => <Stage args={viewArgs()} /> };

/** This computer, or a host with `instance-transfer-full-copy-v1`: each part has its own switch. */
export const Export: Story = {
  name: "Export",
  render: () => <Stage args={viewArgs({ screen: "export", historyAvailable: true, fullCopyAvailable: true })} />,
};

/** A host with only `instance-transfer-chunks-v1`: the chat history also carries the channel messages. */
export const ExportOlderHost: Story = {
  name: "Export: older host",
  render: () => <Stage args={viewArgs({ screen: "export", historyAvailable: true })} />,
};

export const ExportLoading: Story = {
  name: "Export: reading agents",
  render: () => <Stage args={viewArgs({ screen: "export", summary: null })} />,
};

export const ExportSaved: Story = {
  name: "Export: saved",
  render: () => (
    <Stage
      args={viewArgs({ screen: "export", exportPhase: "saved", exportFileName: "openbot-transfer-2026-10-13.zip" })}
    />
  ),
};

export const ExportFailed: Story = {
  name: "Export: failed",
  render: () => (
    <Stage
      args={viewArgs({
        screen: "export",
        exportError:
          "A transfer file must be under 2 GB and 50,000 files. Turn off workspace files, or export fewer agents.",
      })}
    />
  ),
};

export const ImportStart: Story = { name: "Import", render: () => <Stage args={viewArgs({ screen: "import" })} /> };

export const ImportReview: Story = {
  name: "Import: review",
  render: () => (
    <Stage
      args={viewArgs({
        screen: "import",
        importPhase: "review",
        preview: { ...INSTANCE_TRANSFER_PREVIEW, warnings: INSTANCE_TRANSFER_WARNINGS },
      })}
    />
  ),
};

export const ImportResult: Story = {
  name: "Import: result",
  render: () => (
    <Stage
      args={viewArgs({
        screen: "import",
        importPhase: "done",
        result: { ...INSTANCE_TRANSFER_RESULT, agents: STORY_AGENT_SUMMARIES.slice(0, 2) },
      })}
    />
  ),
};

/** Server settings > Transfer > Copy to another server. The preview copies to its joined servers. */
export const CopyInServerSettings: Story = {
  name: "Copy: server settings",
  render: () => (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        instanceTransfer: { onSignIn: fn(), copy: { servers: STORY_SERVERS, onOpenServer: fn() } },
        initialSection: "transfer",
      }}
    />
  ),
};

type CopyArgs = Parameters<typeof CopyAgentsDialog>[0];

const [LOCAL_SERVER, TEAM_SERVER] = STORY_SERVERS;

/** Agents of the other server. Two have the names of agents on this computer. */
const TEAM_AGENTS = [...INSTANCE_TRANSFER_SUMMARY.agents, ...STORY_AGENT_SUMMARIES.slice(0, 2)];

const copyArgs = (overrides: Partial<CopyArgs> = {}): CopyArgs => ({
  servers: STORY_SERVERS,
  fromId: LOCAL_SERVER?.id ?? "local",
  toId: TEAM_SERVER?.id ?? null,
  onFromChange: fn(),
  onToChange: fn(),
  fromAgents: STORY_AGENT_SUMMARIES,
  toAgents: TEAM_AGENTS,
  loadError: null,
  phase: "idle",
  result: null,
  error: null,
  onCopy: fn(),
  onOpenServer: fn(),
  onClose: fn(),
  ...overrides,
});

export const Copy: Story = { name: "Copy", render: () => <CopyAgentsDialog {...copyArgs()} /> };

export const CopyManyAgents: Story = {
  name: "Copy: 50 agents",
  render: () => <CopyAgentsDialog {...copyArgs({ fromAgents: MANY_AGENTS })} />,
};

export const CopyLoading: Story = {
  name: "Copy: reading agents",
  render: () => <CopyAgentsDialog {...copyArgs({ fromAgents: null, toAgents: null })} />,
};

export const CopyCopying: Story = {
  name: "Copy: copying",
  render: () => <CopyAgentsDialog {...copyArgs({ phase: "copying" })} />,
};

export const CopyDone: Story = {
  name: "Copy: done",
  render: () => (
    <CopyAgentsDialog
      {...copyArgs({
        phase: "done",
        result: { ...INSTANCE_TRANSFER_RESULT, agents: STORY_AGENT_SUMMARIES.slice(0, 3) },
      })}
    />
  ),
};

export const CopyFailed: Story = {
  name: "Copy: failed",
  render: () => (
    <CopyAgentsDialog
      {...copyArgs({ error: "This transfer file is too large for the joined server. Choose fewer agents." })}
    />
  ),
};
