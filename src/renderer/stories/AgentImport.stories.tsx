import type { AgentImportResult } from "@openbot/contracts/ipc";
import { AgentImportSources } from "@openbot/ui/features/import/AgentImportSources";
import { AgentImportView } from "@openbot/ui/features/import/AgentImportView";
import { HermesImportView } from "@openbot/ui/features/import/HermesImportView";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  AGENT_IMPORT_PREVIEW,
  AGENT_IMPORT_SKILL,
  AGENT_IMPORT_WARNINGS,
  HERMES_EXPORT_SKILL,
  HERMES_IMPORT_PREVIEW,
} from "./agent-import-fixtures";
import { FILES_NOW } from "./files-fixtures";
import { STORY_AGENT_SUMMARIES } from "./fixtures";
import { ServerSettingsStory, serverSettingsArgs } from "./server-settings-story";

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

function Stage(props: { args?: ViewArgs; narrow?: boolean; children?: JSX.Element }) {
  return (
    <main class="files-story-stage">
      <div class="files-story-page" data-narrow={props.narrow ? "true" : undefined}>
        {props.args ? <AgentImportView {...props.args} /> : props.children}
      </div>
    </main>
  );
}

export const Intro: Story = {
  name: "Import: Steps",
  render: () => <Stage args={viewArgs()} />,
};

export const SetUpYourself: Story = {
  name: "Import: Set up the skill yourself",
  render: () => {
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("agent");
    return <Stage args={viewArgs({ setup: setup(), onSetupChange: setSetup })} />;
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
  render: () => <Stage args={viewArgs({ phase: "review", preview: AGENT_IMPORT_PREVIEW })} />,
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

/** Server settings > Import for this computer. The preview reads a Grok Bot export or the Hermes folder. */
export const InServerSettings: Story = {
  name: "Import: Server settings",
  render: () => (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        agentImport: { onOpenAgent: fn(), onClose: fn() },
        instanceTransfer: { onSignIn: fn() },
        initialSection: "import",
      }}
    />
  ),
};

type HermesArgs = Parameters<typeof HermesImportView>[0];

const hermesArgs = (overrides: Partial<HermesArgs> = {}): HermesArgs => ({
  phase: "review",
  preview: HERMES_IMPORT_PREVIEW,
  result: null,
  onBack: fn(),
  onChooseFolder: fn(),
  onImport: fn(),
  onDone: fn(),
  onOpenAgent: fn(),
  ...overrides,
});

/** The first screen: Hermes, Grok Bot, or another OpenBot computer. */
export const Sources: Story = {
  name: "Import: Sources",
  render: () => (
    <Stage>
      <AgentImportSources transfer onHermes={fn()} onGrok={fn()} onTransfer={fn()} />
    </Stage>
  ),
};

/** A joined server the user does not administer: no Transfer. */
export const SourcesJoinedServer: Story = {
  name: "Import: Sources on a joined server",
  render: () => (
    <Stage>
      <AgentImportSources transfer={false} onHermes={fn()} onGrok={fn()} onTransfer={fn()} />
    </Stage>
  ),
};

const hermesGuideArgs = (overrides: Partial<ViewArgs> = {}): ViewArgs =>
  viewArgs({
    source: "hermes-agent",
    setup: "folder",
    exportSkill: HERMES_EXPORT_SKILL,
    onReadFolder: fn(),
    ...overrides,
  });

/** Hermes on this computer: read its folder, install the export skill with a command, or add it by hand. */
export const HermesSteps: Story = {
  name: "Hermes: Steps",
  render: () => {
    const [setup, setSetup] = createSignal<ViewArgs["setup"]>("folder");
    return (
      <Stage>
        <AgentImportView {...hermesGuideArgs({ setup: setup(), onSetupChange: setSetup })} />
      </Stage>
    );
  },
};

export const HermesInstallCommand: Story = {
  name: "Hermes: Install with a command",
  render: () => (
    <Stage>
      <AgentImportView {...hermesGuideArgs({ setup: "command" })} />
    </Stage>
  ),
};

export const HermesSkillYourself: Story = {
  name: "Hermes: Set it up yourself",
  render: () => (
    <Stage>
      <AgentImportView {...hermesGuideArgs({ setup: "skill" })} />
    </Stage>
  ),
};

/** A joined server cannot read this computer's folder, so Hermes offers the export only. */
export const HermesStepsJoinedServer: Story = {
  name: "Hermes: Steps on a joined server",
  render: () => (
    <Stage>
      <AgentImportView {...hermesGuideArgs({ setup: "command", onReadFolder: undefined })} />
    </Stage>
  ),
};

/** An export the skill made in Hermes: the same review as a Grok Bot export. */
export const HermesExportReview: Story = {
  name: "Hermes: Export review",
  render: () => (
    <Stage>
      <AgentImportView
        {...hermesGuideArgs({
          phase: "review",
          preview: {
            ...AGENT_IMPORT_PREVIEW,
            sourceApp: "hermes-agent",
            exportedAt: "2026-10-21T10:00:00.000Z",
            agents: AGENT_IMPORT_PREVIEW.agents.map((agent) => ({
              ...agent,
              avatarUrl: null,
              fileCount: 0,
              fileBytes: 0,
            })),
            channels: [],
          },
        })}
      />
    </Stage>
  ),
};

/** Every item of every profile, with what needs approval and what stays in Hermes. */
export const HermesReview: Story = {
  name: "Hermes: Review",
  render: () => (
    <Stage>
      <HermesImportView {...hermesArgs()} />
    </Stage>
  ),
};

/** A second import: the profile imported before updates its agent, or is left as it is. */
export const HermesSecondImport: Story = {
  name: "Hermes: Second import",
  render: () => (
    <Stage>
      <HermesImportView
        {...hermesArgs({
          preview: {
            ...HERMES_IMPORT_PREVIEW,
            profiles: HERMES_IMPORT_PREVIEW.profiles.map((profile) =>
              profile.key === "default" ? { ...profile, agent: { id: "agent-hermes", name: "Hermes" } } : profile,
            ),
          },
        })}
      />
    </Stage>
  ),
};

export const HermesNotFound: Story = {
  name: "Hermes: No profiles found",
  render: () => (
    <Stage>
      <HermesImportView {...hermesArgs({ phase: "missing", preview: null })} />
    </Stage>
  ),
};

export const HermesDone: Story = {
  name: "Hermes: Done",
  render: () => (
    <Stage>
      <HermesImportView
        {...hermesArgs({
          phase: "done",
          preview: null,
          updated: new Set(RESULT.agents.slice(0, 1).map((agent) => agent.id)),
          result: {
            ...RESULT,
            channels: [],
            warnings: [
              "Research desk: SOUL.md is longer than 2000 characters, so the instructions keep its start. The full file is in imported/hermes/SOUL.md.",
              "filesystem: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in MCP settings.",
            ],
          },
        })}
      />
    </Stage>
  ),
};
