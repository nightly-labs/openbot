import { AttachmentCards } from "@openbot/ui/features/conversation/AttachmentCards";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AUDIO_PREVIEW } from "./file-previews";
import { STORY_ATTACHMENTS } from "./fixtures";

const compactFile = {
  id: "attachment-index",
  name: "index.html",
  size: 65 * 1024,
  kind: "file" as const,
  mimeType: "text/html",
  previewKind: "text" as const,
  previewUrl: null,
};

const longNamedFiles = [
  {
    ...compactFile,
    id: "attachment-long-typescript",
    name: "customer-import-validation-pipeline.final.review.ts",
    mimeType: "text/typescript",
  },
  {
    ...compactFile,
    id: "attachment-long-spreadsheet",
    name: "quarterly-operating-plan-with-regional-breakdown.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    previewKind: "none" as const,
  },
];

const args: Parameters<typeof AttachmentCards>[0] = {
  attachments: STORY_ATTACHMENTS,
  onPreview: fn(),
  onAction: fn(),
};

const meta = {
  title: "Conversation/AttachmentCards",
  component: AttachmentCards,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AttachmentCards>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Files: Story = {};

export const SingleCompactFile: Story = {
  name: "Single compact file",
  args: { attachments: [compactFile] },
};

export const NarrowLongNames: Story = {
  name: "Narrow layout with long names",
  args: { attachments: longNamedFiles },
  render: (storyArgs) => (
    <div style={{ width: "220px" }}>
      <AttachmentCards {...storyArgs} />
    </div>
  ),
};

export const Empty: Story = {
  args: { attachments: [] },
};

export const AudioTakes: Story = {
  name: "Inline audio takes",
  args: {
    attachments: [1, 2, 3].map((take) => ({
      id: `audio-take-${take}`,
      name: `voice-over-${take}.mp3`,
      size: AUDIO_PREVIEW.size,
      kind: "file",
      mimeType: AUDIO_PREVIEW.mimeType,
      previewKind: "none",
      previewUrl: `data:audio/mpeg;base64,${btoa(String.fromCharCode(...(AUDIO_PREVIEW.bytes ?? [])))}`,
    })),
  },
};

export const NarrowAudioTakes: Story = {
  ...AudioTakes,
  name: "Inline audio in a narrow layout",
  render: (storyArgs) => (
    <div style={{ width: "220px" }}>
      <AttachmentCards {...storyArgs} />
    </div>
  ),
};
