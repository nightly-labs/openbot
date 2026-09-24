import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { DraftAttachment, InstalledSkill } from "@openbot/contracts/ipc";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS, STORY_MCP_SERVERS } from "./fixtures";

const args: Parameters<typeof ComposerEditor>[0] = {
  agentId: "chief",
  agents: STORY_AGENTS,
  attachments: [],
  value: "",
  placeholder: "Message Chief",
  ariaLabel: "Message Chief",
  disabled: false,
  onValueChange: fn(),
  onSubmit: fn(),
  onOpenAttachment: fn(),
};

const referencedFiles: DraftAttachment[] = [
  {
    id: "draft-start-types",
    name: "start-types.d.ts",
    size: 6_144,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "draft-agents",
    name: "AGENTS.md",
    size: 2_048,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  },
];

const longReferencedFile: DraftAttachment = {
  id: "draft-long-report",
  name: "bardzo-długi-raport-źródłowy-z-wynikami-eksperymentu-i-komentarzami-finalnymi.ts",
  size: 48_120,
  kind: "file",
  mimeType: "text/plain",
  previewKind: "text",
  previewUrl: null,
};

const installedSkills: InstalledSkill[] = [
  {
    skillId: "skill-release-notes",
    slug: "release-notes",
    name: "Release Notes",
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    description: "Turns a range of commits into a changelog a reader outside the team can follow.",
  },
  {
    skillId: "skill-transitions-polish",
    slug: "transitions-polish",
    name: "Transitions Polish",
    installedVersion: 2,
    availableVersion: 2,
    state: "installed",
    origin: "local",
    description: "Polish and refine existing motion against the transitions.dev method.",
  },
  {
    skillId: "skill-site-hosting",
    slug: "openbot-site-hosting",
    name: "Site Hosting",
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    origin: "managed",
  },
  {
    skillId: "skill-shadcn-to-zaidan",
    slug: "shadcn-to-zaidan",
    name: "Shadcn To Zaidan",
    installedVersion: 3,
    availableVersion: 3,
    state: "installed",
    origin: "marketplace",
    description: "Port and sync shadcn-style React components, blocks and examples onto Zaidan.",
  },
];

const longDescriptionSkill: InstalledSkill = {
  skillId: "skill-incident-review",
  slug: "incident-review",
  name: "Incident Review",
  installedVersion: 1,
  availableVersion: 1,
  state: "installed",
  origin: "local",
  description:
    "Collects the timeline, the alerts and the chat around an incident, then writes the review the team reads the next morning, with the contributing causes, the repair work and the owner of each follow-up item.",
};

/**
 * The picker grows out of the top edge of the composer, so a picker story keeps empty room above
 * the composer. A compact composer holds the editor in the middle grid column, and the picker
 * stretches back out to the edges of the composer.
 */
function composerFrame(storyArgs: Parameters<typeof ComposerEditor>[0], options: { width: string; compact?: boolean }) {
  const [value, setValue] = createSignal(storyArgs.value);
  // The picker hangs off the composer inside `.composer-wrap`, the way the conversation renders it.
  return (
    <div class="composer-wrap" style={{ width: options.width, "margin-top": "260px" }}>
      <div class="composer" data-compact={options.compact ? "" : undefined}>
        <div class="composer-input-label">
          <ComposerEditor {...storyArgs} value={value()} onValueChange={setValue} onSubmit={storyArgs.onSubmit} />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Conversation/ComposerEditor",
  component: ComposerEditor,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ComposerEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithDraft: Story = {
  args: { value: "Prepare a concise update for tomorrow." },
};

export const LongMultilineDraft: Story = {
  args: {
    value: Array.from({ length: 30 }, (_, index) => `Line ${index + 1}: Edit this part of the draft.`).join("\n"),
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const WithAgentAndSkillTags: Story = {
  args: {
    skills: installedSkills,
    value: `Ask ${serializeChatTagReference("agent", "Research", "research")} to use ${serializeChatTagReference("skill", "Release Notes", "skill-release-notes")}.`,
  },
};

export const WithUnavailableTags: Story = {
  args: {
    value: `Ask ${serializeChatTagReference("agent", "Former Agent", "removed-agent")} to use ${serializeChatTagReference("skill", "Old Skill", "removed-skill")}.`,
  },
};

export const Disabled: Story = {
  args: { disabled: true, placeholder: "Complete agent setup to start" },
};

export const MentionPicker: Story = {
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const SkillPicker: Story = {
  args: {
    skills: installedSkills,
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const McpServerPicker: Story = {
  args: {
    skills: installedSkills,
    mcpServers: STORY_MCP_SERVERS,
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const SkillPickerLongDescription: Story = {
  args: {
    skills: [longDescriptionSkill, ...installedSkills],
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const CompactComposerPicker: Story = {
  args: {
    skills: installedSkills,
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "360px", compact: true }),
};

export const FileReferencePicker: Story = {
  args: {
    attachments: referencedFiles,
    onOpenAttachment: fn(),
  },
  render: (storyArgs) => composerFrame(storyArgs, { width: "480px" }),
};

export const WithFileReferences: Story = {
  args: {
    attachments: referencedFiles,
    value: `${serializeAttachmentReference("start-types.d.ts", "draft-start-types")} ${serializeAttachmentReference("AGENTS.md", "draft-agents")}`,
  },
  render: (storyArgs) => (
    <div class="composer" style={{ width: "480px" }}>
      <div class="composer-input-label">
        <ComposerEditor {...storyArgs} />
      </div>
    </div>
  ),
};

export const LongFileReference: Story = {
  args: {
    attachments: [longReferencedFile],
    value: serializeAttachmentReference(longReferencedFile.name, longReferencedFile.id),
    onOpenAttachment: fn(),
  },
  render: (storyArgs) => (
    <div class="composer" style={{ width: "320px" }}>
      <div class="composer-input-label">
        <ComposerEditor {...storyArgs} />
      </div>
    </div>
  ),
};
