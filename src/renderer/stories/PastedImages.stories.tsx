import {
  attachmentReferenceIds,
  removeAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import {
  ComposerAttachmentRow,
  type ComposerPendingImage,
  type ComposerUploadFile,
} from "@openbot/ui/features/conversation/ComposerAttachmentRow";
import { ComposerEditor } from "@openbot/ui/features/conversation/ComposerEditor";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import desktopScreenshot from "./assets/remote-desktop-mac-mock.png";
import { STORY_AGENTS } from "./fixtures";

const logo = new URL("../src/assets/openbot-logo-production.png", import.meta.url).href;

function image(id: string, previewUrl: string, name = "image.png"): DraftAttachment {
  return { id, name, size: 151_552, kind: "image", mimeType: "image/png", previewKind: "image", previewUrl };
}

const pastedScreenshot = image("pasted-screenshot", desktopScreenshot);
const pastedLogo = image("pasted-logo", logo);
const brief: DraftAttachment = {
  id: "launch-brief",
  name: "launch-brief.md",
  size: 6_144,
  kind: "file",
  mimeType: "text/markdown",
  previewKind: "text",
  previewUrl: null,
};
const pendingScreenshot: ComposerPendingImage = { id: "pending", name: "image.png", url: desktopScreenshot };

const MB = 1024 * 1024;
const uploadingArchive: ComposerUploadFile = {
  key: "archive",
  uploadId: "archive",
  name: "customer-interviews-transcripts-2026-10.zip",
  size: 96.2 * MB,
  sent: 39.4 * MB,
  error: null,
};
const startingPhoto: ComposerUploadFile = {
  key: "photo",
  uploadId: "photo",
  name: "warehouse-floor.jpg",
  size: 4.1 * MB,
  sent: null,
  error: null,
};
const failedArchive: ComposerUploadFile = {
  ...uploadingArchive,
  error: "The connection to OpenBot team closed.",
};

const named = (text: string, file: DraftAttachment) => `${text} ${serializeAttachmentReference(file.name, file.id)}`;

function Composer(props: {
  attachments: DraftAttachment[];
  pending?: ComposerPendingImage[];
  uploads?: ComposerUploadFile[];
  text: string;
  width: string;
}) {
  const [attachments, setAttachments] = createSignal(props.attachments);
  const [uploads, setUploads] = createSignal(props.uploads ?? []);
  const [value, setValue] = createSignal(props.text);
  const row = () => {
    const referenced = attachmentReferenceIds(value());
    return attachments().filter((file) => file.kind === "image" || !referenced.has(file.id));
  };
  const hasRow = () => row().length > 0 || (props.pending?.length ?? 0) > 0 || uploads().length > 0;
  return (
    <div class="composer-wrap" style={{ width: props.width, "max-width": "calc(100vw - 32px)" }}>
      <div class="composer" data-has-attachments={hasRow() ? "" : undefined}>
        <ComposerAttachmentRow
          attachments={row()}
          pending={props.pending}
          uploads={uploads()}
          onRemoveUpload={(uploadId) => setUploads((current) => current.filter((item) => item.uploadId !== uploadId))}
          onRetryUpload={(uploadId) =>
            setUploads((current) =>
              current.map((item) => (item.uploadId === uploadId ? { ...item, sent: null, error: null } : item)),
            )
          }
          onRemove={(removed) => {
            setValue((current) => removeAttachmentReferences(current, removed.id));
            setAttachments((current) => current.filter((item) => item.id !== removed.id));
          }}
        />
        <div class="composer-input-label">
          <ComposerEditor
            agentId="chief"
            agents={STORY_AGENTS}
            attachments={attachments()}
            value={value()}
            placeholder="Message Chief"
            ariaLabel="Message Chief"
            disabled={false}
            onValueChange={setValue}
            onSubmit={fn()}
          />
        </div>
      </div>
    </div>
  );
}

const rowCallbacks = { onSelectAgent: fn(), onOpenLink: fn(), onPreview: fn(), onAttachmentAction: fn() };

function SentMessage(props: { message: AgentMessage; width: string }) {
  return (
    <main class="foundation-story" style={{ width: props.width, "max-width": "calc(100vw - 32px)" }}>
      <ChatMessageRow
        message={props.message}
        author={{ kind: "you", name: "You" }}
        agents={STORY_AGENTS}
        {...rowCallbacks}
      />
    </main>
  );
}

const meta = {
  title: "Conversation/PastedImages",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ComposerWithPastedImage: Story = {
  render: () => <Composer attachments={[pastedScreenshot]} text={named("Okay", pastedScreenshot)} width="640px" />,
};

export const ComposerImageWithoutToken: Story = {
  render: () => <Composer attachments={[pastedScreenshot]} text="Okay" width="640px" />,
};

export const ComposerWithSeveralFiles: Story = {
  render: () => (
    <Composer
      attachments={[pastedScreenshot, pastedLogo, brief]}
      text={named(named(named("Compare", pastedScreenshot), pastedLogo), brief)}
      width="640px"
    />
  ),
};

export const ComposerWhileImageAdds: Story = {
  render: () => (
    <Composer attachments={[pastedLogo]} pending={[pendingScreenshot]} text={named("Okay", pastedLogo)} width="640px" />
  ),
};

export const ComposerWhileFilesUpload: Story = {
  render: () => <Composer attachments={[brief]} uploads={[uploadingArchive, startingPhoto]} text="" width="760px" />,
};

export const ComposerUploadFailed: Story = {
  render: () => <Composer attachments={[brief]} uploads={[failedArchive, startingPhoto]} text="" width="760px" />,
};

export const ComposerNarrow: Story = {
  render: () => (
    <Composer
      attachments={[pastedScreenshot, pastedLogo]}
      text={named(named("Okay", pastedScreenshot), pastedLogo)}
      width="360px"
    />
  ),
};

export const SentImage: Story = {
  render: () => (
    <SentMessage
      width="760px"
      message={{ id: "sent-image", author: "you", body: "Okay", time: "11:22", attachments: [pastedScreenshot] }}
    />
  ),
};

export const SentImages: Story = {
  render: () => (
    <SentMessage
      width="760px"
      message={{
        id: "sent-images",
        author: "you",
        body: "Here are both",
        time: "11:22",
        attachments: [pastedScreenshot, pastedLogo],
      }}
    />
  ),
};

export const SentImageNamedInline: Story = {
  render: () => (
    <SentMessage
      width="760px"
      message={{
        id: "sent-inline",
        author: "you",
        body: "Look at @[image.png](attachment:pasted-screenshot)",
        time: "11:22",
        attachments: [pastedScreenshot],
      }}
    />
  ),
};

export const SentImagesOnly: Story = {
  render: () => (
    <SentMessage
      width="760px"
      message={{ id: "sent-only", author: "you", body: "", time: "11:22", attachments: [pastedScreenshot] }}
    />
  ),
};

export const SentImageNarrow: Story = {
  render: () => (
    <SentMessage
      width="360px"
      message={{ id: "sent-narrow", author: "you", body: "Okay", time: "11:22", attachments: [pastedScreenshot] }}
    />
  ),
};
