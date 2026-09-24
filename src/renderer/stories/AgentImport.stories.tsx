import type { AgentImportResult } from "@openbot/contracts/ipc";
import { Blocks, Download, HardDrive, Monitor, Settings, Tabs, UsersRound } from "@openbot/ui";
import { AgentImportView } from "@openbot/ui/features/import/AgentImportView";
import { SettingsDialogShell } from "@openbot/ui/features/settings/SettingsDialogShell";
import { createSignal } from "solid-js";
import { expect, fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AGENT_IMPORT_PREVIEW, AGENT_IMPORT_SKILL, AGENT_IMPORT_WARNINGS } from "./agent-import-fixtures";
import { FILES_NOW } from "./files-fixtures";
import { STORY_AGENT_SUMMARIES } from "./fixtures";

const meta = {
  title: "Settings/AgentImport",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type ViewArgs = Parameters<typeof AgentImportView>[0];

const viewArgs = (overrides: Partial<ViewArgs> = {}): ViewArgs => ({
  phase: "idle",
  now: FILES_NOW,
  setup: "agent",
  exportSkill: AGENT_IMPORT_SKILL,
  onSetupChange: fn(),
  onOpenExportAgent: fn(),
  onSaveExportSkill: fn(),
  onChoose: fn(),
  onImport: fn(),
  onCancel: fn(),
  onDone: fn(),
  onOpenAgent: fn(),
  ...overrides,
});

const RESULT: AgentImportResult = {
  agents: STORY_AGENT_SUMMARIES.slice(0, 2),
  skipped: [],
  channels: [{ id: "channel-pipeline", name: "Pipeline review" }],
  skippedChannels: [],
  warnings: [],
};

function Stage(props: { args: ViewArgs; narrow?: boolean }) {
  return (
    <main class="files-story-stage">
      <div class="files-story-page" data-narrow={props.narrow ? "true" : undefined}>
        <AgentImportView {...props.args} />
      </div>
    </main>
  );
}

export const Intro: Story = {
  name: "Import: Steps",
  render: () => <Stage args={viewArgs()} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Open the export agent" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Choose export file/u })).toBeEnabled();
  },
};

export const SetUpYourself: Story = {
  name: "Import: Set up the skill yourself",
  render: () => {
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("agent");
    const onSaveExportSkill = fn();
    return <Stage args={viewArgs({ setup: setup(), onSetupChange: setSetup, onSaveExportSkill })} />;
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Set it up yourself" }));
    await expect(canvas.getByRole("button", { name: "Copy" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: /^Save file/u })).toBeVisible();
  },
};

export const Reading: Story = {
  name: "Import: Reading the export",
  render: () => <Stage args={viewArgs({ phase: "reading" })} />,
};

export const OpenFailed: Story = {
  name: "Import: Export could not be opened",
  render: () => (
    <Stage
      args={viewArgs({
        error: "The export contains an unsafe file: agents/research/files/.env",
      })}
    />
  ),
};

export const Review: Story = {
  name: "Import: Review",
  render: () => {
    const onImport = fn();
    return <Stage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW, onImport })} />;
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Import 3 agents and 2 channels" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("checkbox", { name: "Import Sales Outbound" }));
    await userEvent.click(canvas.getByRole("checkbox", { name: "Import Research" }));
    await expect(canvas.getByText("1 of 3 selected")).toBeVisible();
    // A channel keeps the members that stay selected, and needs one of them.
    await expect(canvas.getByRole("checkbox", { name: "Import Pipeline review" })).toBeDisabled();
    await expect(canvas.getByText("Select at least one of its agents to import it.")).toBeVisible();
    await expect(canvas.getByText("Imports without Research, Sales Outbound.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Import 1 agent and 1 channel" })).toBeEnabled();
  },
};

export const ReviewWithWarnings: Story = {
  name: "Import: Review with warnings",
  render: () => (
    <Stage
      args={viewArgs({
        phase: "review",
        preview: { ...AGENT_IMPORT_PREVIEW, warnings: AGENT_IMPORT_WARNINGS },
      })}
    />
  ),
};

export const Importing: Story = {
  name: "Import: Importing",
  render: () => <Stage args={viewArgs({ phase: "importing", preview: AGENT_IMPORT_PREVIEW })} />,
};

export const Done: Story = {
  name: "Import: Done",
  render: () => <Stage args={viewArgs({ phase: "done", result: RESULT })} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: `Open ${STORY_AGENT_SUMMARIES[0]?.name}` })).toBeVisible();
  },
};

export const PartlyDone: Story = {
  name: "Import: Some agents did not import",
  render: () => (
    <Stage
      args={viewArgs({
        phase: "done",
        result: {
          agents: STORY_AGENT_SUMMARIES.slice(0, 1),
          skipped: [{ key: "inbox", name: "Inbox Triage", reason: "SKILL.md must begin with YAML frontmatter." }],
          channels: [],
          skippedChannels: [{ key: "desk", name: "Front desk", reason: "None of its agents were imported." }],
          warnings: ["Research: routine “Hourly price check” is skipped. The schedule runs too often."],
        },
      })}
    />
  ),
};

export const ReviewNarrow: Story = {
  name: "Import: Narrow",
  render: () => <Stage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} narrow />,
};

// The same sections and icons as the real ServerSettingsModal for this computer.
const SERVER_SETTINGS_NAV = [
  { value: "general", label: "General", icon: Settings },
  { value: "members", label: "Members", icon: UsersRound },
  { value: "desktop", label: "Remote desktop", icon: Monitor },
  { value: "mcp", label: "MCP", icon: Blocks },
  { value: "storage", label: "Storage", icon: HardDrive },
  { value: "import", label: "Import", icon: Download },
] as const;

function ServerSettingsStage(props: { args: ViewArgs }) {
  const [tab, setTab] = createSignal("import");
  return (
    <Tabs.Root value={tab()} onChange={setTab} orientation="vertical" class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="server-settings-modal-shell"
        open
        onOpenChange={() => undefined}
        title="Import"
        description="Move your agents from Grok Bot to this computer."
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
        <Tabs.Content value="import" class="settings-modal-tab-panel server-settings-panel" data-tab="import">
          <AgentImportView {...props.args} />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}

export const InServerSettings: Story = {
  name: "Import: Server settings",
  render: () => <ServerSettingsStage args={viewArgs()} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Import" });
    await expect(within(dialog).getByRole("tab", { name: "Import" })).toHaveAttribute("aria-selected", "true");
  },
};

export const ReviewInServerSettings: Story = {
  name: "Import: Review in Server settings",
  render: () => <ServerSettingsStage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} />,
};
