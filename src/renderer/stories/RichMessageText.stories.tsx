import { serializeAttachmentReference } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { MessageCitation } from "@openbot/ui/data";
import { RichMessageText } from "@openbot/ui/features/conversation/RichMessageText";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS, STORY_ATTACHMENTS, STORY_INSTALLED_SKILLS } from "./fixtures";

const args: Parameters<typeof RichMessageText>[0] = {
  body: "Ask @Research to review https://openbot.run/docs before the launch.",
  agents: STORY_AGENTS,
  attachments: [],
  onSelectAgent: fn(),
  onOpenLink: fn(),
  onOpenAttachment: fn(),
};

const citations: MessageCitation[] = [
  {
    number: 1,
    label: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
    host: "arxiv.org",
  },
  {
    number: 2,
    label: "Efficient Transformers: A Survey",
    url: "https://arxiv.org/abs/2009.06732",
    host: "arxiv.org",
  },
];

const longAttachment: AttachmentSummary = {
  id: "attachment-long",
  name: "bardzo-długi-raport-źródłowy-z-wynikami-eksperymentu-i-komentarzami-finalnymi.ts",
  size: 48_120,
  kind: "file",
  mimeType: "text/plain",
  previewKind: "text",
  previewUrl: null,
};

type AttachmentFixtureInput = readonly [
  string,
  string,
  string,
  AttachmentSummary["previewKind"],
  AttachmentSummary["kind"],
];

const fileTypeInputs: AttachmentFixtureInput[] = [
  ["type-ts", "start-types.ts", "text/plain", "text", "file"],
  ["type-js", "client.js", "text/javascript", "text", "file"],
  ["type-html", "index.html", "text/html", "text", "file"],
  ["type-css", "styles.css", "text/css", "text", "file"],
  ["type-xlsx", "budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "none", "file"],
  ["type-pdf", "brief.pdf", "application/pdf", "pdf", "file"],
  ["type-png", "diagram.png", "image/png", "image", "image"],
  ["type-cs", "Program.cs", "text/plain", "text", "file"],
  ["type-extensionless", "LICENSE", "application/octet-stream", "none", "file"],
];

const fileTypeAttachments: AttachmentSummary[] = fileTypeInputs.map(
  ([id, name, mimeType, previewKind, kind], index) => ({
    id,
    name,
    size: (index + 1) * 2_048,
    kind,
    mimeType,
    previewKind,
    previewUrl: null,
  }),
);

const firstStoryAttachment = requireFixture(STORY_ATTACHMENTS[0], "Story attachment 0");
const secondStoryAttachment = requireFixture(STORY_ATTACHMENTS[1], "Story attachment 1");
const secondFileTypeAttachment = requireFixture(fileTypeAttachments[1], "File type attachment 1");
const fourthFileTypeAttachment = requireFixture(fileTypeAttachments[3], "File type attachment 3");

const meta = {
  title: "Conversation/RichMessageText",
  component: RichMessageText,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof RichMessageText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LinksAndMentions: Story = {};

export const SkillChip: Story = {
  args: {
    body: `Use ${serializeChatTagReference("skill", "Release notes", "skill-release-notes")} to turn the latest notes into a short plan.`,
    skills: STORY_INSTALLED_SKILLS.chief,
  },
};

export const AgentAndSkillChips: Story = {
  args: {
    body: `Ask @Research to use ${serializeChatTagReference("skill", "Release notes", "skill-release-notes")} for the next release.`,
    skills: STORY_INSTALLED_SKILLS.chief,
  },
};

export const InlineCitations: Story = {
  args: {
    body: "Transformers scale well with data and compute [1], though attention is quadratic in sequence length [2].",
    citations,
  },
};

export const CitationEdges: Story = {
  args: { body: "", citations },
  parameters: { layout: "fullscreen" },
  render: (storyArgs) => (
    <div
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        width: "100vw",
        "box-sizing": "border-box",
        padding: "0 8px",
      }}
    >
      <p style={{ margin: "0" }}>
        <RichMessageText {...storyArgs} body="[1] Citation at the left edge." />
      </p>
      <p style={{ "margin-top": "64px", "text-align": "right" }}>
        <RichMessageText {...storyArgs} body="Citation at the right edge [2]" />
      </p>
    </div>
  ),
};

export const PlainText: Story = {
  args: { body: "A message without links or agent mentions." },
};

export const InlineFileReferences: Story = {
  args: {
    body: `Review ${serializeAttachmentReference(firstStoryAttachment.name, firstStoryAttachment.id)} and keep the implementation aligned with ${serializeAttachmentReference(secondStoryAttachment.name, secondStoryAttachment.id)}.`,
    attachments: STORY_ATTACHMENTS,
    onOpenAttachment: fn(),
  },
};

export const PlainFileReferences: Story = {
  args: {
    body: `Here is ${firstStoryAttachment.name}. You can also review ~/OpenBot/Shared/brief.pdf.`,
    attachments: [firstStoryAttachment],
    onOpenAttachment: fn(),
    onOpenSharedFile: fn(),
  },
};

export const LongFileReference: Story = {
  args: {
    body: `Review ${serializeAttachmentReference(longAttachment.name, longAttachment.id)} before continuing.`,
    attachments: [longAttachment],
    onOpenAttachment: fn(),
  },
  render: (storyArgs) => (
    <section aria-label="Long file reference sample" style={{ width: "320px" }}>
      <RichMessageText {...storyArgs} />
    </section>
  ),
};

export const FileReferenceTypes: Story = {
  args: {
    body: fileTypeAttachments
      .map((attachment) => serializeAttachmentReference(attachment.name, attachment.id))
      .join(" "),
    attachments: fileTypeAttachments,
  },
  render: (storyArgs) => (
    <p style={{ width: "620px" }}>
      <RichMessageText {...storyArgs} />
    </p>
  ),
};

export const MixedReferencesStress: Story = {
  name: "Mixed references stress",
  args: {
    body: `Ask @Research to compare ${serializeAttachmentReference(longAttachment.name, longAttachment.id)} with ${serializeAttachmentReference(secondFileTypeAttachment.name, secondFileTypeAttachment.id)} and https://openbot.run/docs. Keep the decision traceable to the primary paper [1], then verify the compressed handoff in ${serializeAttachmentReference(fourthFileTypeAttachment.name, fourthFileTypeAttachment.id)} before shipping [2].`,
    attachments: [longAttachment, secondFileTypeAttachment, fourthFileTypeAttachment],
    citations,
    onOpenAttachment: fn(),
  },
  render: (storyArgs) => (
    <article aria-label="Mixed references stress sample" style={{ width: "360px" }}>
      <RichMessageText {...storyArgs} />
    </article>
  ),
};

export const InlineAlignment: Story = {
  name: "Inline alignment",
  args: {
    body: `Review ${serializeAttachmentReference(secondFileTypeAttachment.name, secondFileTypeAttachment.id)} before launch.`,
    attachments: [secondFileTypeAttachment],
  },
  render: (storyArgs) => (
    <article aria-label="Inline alignment sample" style={{ width: "360px" }}>
      <RichMessageText {...storyArgs} />
    </article>
  ),
};
