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

/** The text with a file token, as a paste puts it at the cursor. */
const named = (text: string, file: DraftAttachment) => `${text} ${serializeAttachmentReference(file.name, file.id)}`;

/**
 * The message box of a chat, a side thread or the Tasks page. A file token in the text shows where the
 * file is; an image also shows in the thumbnail row.
 */
function Composer(props: {
  attachments: DraftAttachment[];
  pending?: ComposerPendingImage[];
  text: string;
  width: string;
}) {
  const [attachments, setAttachments] = createSignal(props.attachments);
  const [value, setValue] = createSignal(props.text);
  const row = () => {
    const referenced = attachmentReferenceIds(value());
    return attachments().filter((file) => file.kind === "image" || !referenced.has(file.id));
  };
  const hasRow = () => row().length > 0 || (props.pending?.length ?? 0) > 0;
  return (
    <div class="composer-wrap" style={{ width: props.width, "max-width": "calc(100vw - 32px)" }}>
      <div class="composer" data-has-attachments={hasRow() ? "" : undefined}>
        <ComposerAttachmentRow
          attachments={row()}
          pending={props.pending}
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

/** A sent message in the timeline: its images stand above the text bubble, outside it. */
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

/** A pasted image shows in the thumbnail row, and its token marks where it is in the text. Hover a tile for its remove button. */
export const ComposerWithPastedImage: Story = {
  render: () => <Composer attachments={[pastedScreenshot]} text={named("Okay", pastedScreenshot)} width="640px" />,
};

/** When the token is deleted, the image stays in the row and still goes with the message. */
export const ComposerImageWithoutToken: Story = {
  render: () => <Composer attachments={[pastedScreenshot]} text="Okay" width="640px" />,
};

/** Images and a file. A file other than an image shows only as its token, until its token is deleted. */
export const ComposerWithSeveralFiles: Story = {
  render: () => (
    <Composer
      attachments={[pastedScreenshot, pastedLogo, brief]}
      text={named(named(named("Compare", pastedScreenshot), pastedLogo), brief)}
      width="640px"
    />
  ),
};

/** A paste that takes longer than 150 ms shows its local preview with a spinner until it is ready. */
export const ComposerWhileImageAdds: Story = {
  render: () => (
    <Composer attachments={[pastedLogo]} pending={[pendingScreenshot]} text={named("Okay", pastedLogo)} width="640px" />
  ),
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

/** The image stands above the text bubble, outside it. */
export const SentImage: Story = {
  render: () => (
    <SentMessage
      width="760px"
      message={{ id: "sent-image", author: "you", body: "Okay", time: "11:22", attachments: [pastedScreenshot] }}
    />
  ),
};

/** Several images share one gallery. */
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

/** An image that the text also names inline keeps its chip and shows full size. */
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

/** A message of images only has no bubble. */
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
