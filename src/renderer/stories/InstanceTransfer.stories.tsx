import { InstanceTransferView } from "@openbot/ui/features/transfer/InstanceTransferView";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import {
  INSTANCE_TRANSFER_PREVIEW,
  INSTANCE_TRANSFER_RESULT,
  INSTANCE_TRANSFER_SUMMARY,
  INSTANCE_TRANSFER_WARNINGS,
} from "./instance-transfer-fixtures";
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
      settings={{ ...serverSettingsArgs(), instanceTransfer: { onSignIn: fn() }, initialSection: "transfer" }}
    />
  ),
};

export const Home: Story = { name: "Which computer", render: () => <Stage args={viewArgs()} /> };

export const Export: Story = { name: "Export", render: () => <Stage args={viewArgs({ screen: "export" })} /> };

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
