import {
  attachmentReferenceIds,
  expandAttachmentReferences,
  serializeAttachmentReference,
} from "@openbot/contracts/attachment-references";
import { expandChatTagReferences } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AttachmentSummary, FilePreview } from "@openbot/contracts/ipc";
import { expandComposerMentions } from "@openbot/ui/features/conversation/ComposerEditor";
import { currentText } from "@openbot/ui/text";
import { Option, Schema } from "effect";
import { writeClipboardText } from "../../clipboard";
import { keptSpaces } from "../../selection-copy";

const HTML_ATTRIBUTE = "data-openbot-composer-fragment";
const decodeFragment = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      copyId: Schema.String.check(Schema.isMaxLength(128)),
    }),
  ),
);
type PreviewAttachment = (attachment: AttachmentSummary) => Promise<FilePreview>;
interface CopiedAttachment {
  attachment: AttachmentSummary;
  file: () => Promise<File>;
}
interface ComposerCopy {
  id: string;
  text: string;
  files: CopiedAttachment[];
}
export interface PastedComposerCopy {
  text: string;
  sourceIds: string[];
  files: Promise<File>[];
}

const attachmentFiles = new WeakMap<AttachmentSummary, Promise<File>>();
let latestCopy: ComposerCopy | null = null;

export function rememberComposerFile(attachment: AttachmentSummary, file: File): void {
  attachmentFiles.set(attachment, Promise.resolve(file));
}

function attachmentFile(attachment: AttachmentSummary, preview?: PreviewAttachment): Promise<File> {
  const cached = attachmentFiles.get(attachment);
  if (cached) return cached;
  const file = (async () => {
    if (attachment.previewUrl) {
      const response = await fetch(attachment.previewUrl);
      if (!response.ok) throw new Error(currentText().t("attachment.previewUnavailable"));
      return new File([await response.blob()], attachment.name, { type: attachment.mimeType });
    }
    const result = await preview?.(attachment);
    if (!result?.bytes) throw new Error(currentText().t("attachment.previewUnavailable"));
    return new File([new Uint8Array(result.bytes)], attachment.name, { type: attachment.mimeType });
  })();
  attachmentFiles.set(attachment, file);
  void file.catch(() => attachmentFiles.delete(attachment));
  return file;
}

function createCopy(text: string, attachments: AttachmentSummary[], preview?: PreviewAttachment): ComposerCopy {
  const referenced = attachmentReferenceIds(text);
  const extra = attachments
    .filter((attachment) => !referenced.has(attachment.id))
    .map((attachment) => serializeAttachmentReference(attachment.name, attachment.id));
  const copy: ComposerCopy = {
    id: crypto.randomUUID(),
    text: [text, ...extra].filter(Boolean).join(" "),
    files: attachments.map((attachment) => {
      let file: Promise<File> | undefined;
      return { attachment, file: () => (file ??= attachmentFile(attachment, preview)) };
    }),
  };
  latestCopy = copy;
  return copy;
}

export function copiedFileRead(id: string): Promise<void> {
  const entry = latestCopy?.files.find((file) => file.attachment.id === id);
  return entry
    ? entry.file().then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
}

function fragmentHtml(copy: ComposerCopy, plainText: string): string {
  const element = document.createElement("div");
  element.setAttribute(HTML_ATTRIBUTE, encodeURIComponent(JSON.stringify({ version: 1, copyId: copy.id })));
  plainText.split("\n").forEach((line, index) => {
    if (index > 0) element.append(document.createElement("br"));
    element.append(keptSpaces(line));
  });
  return element.outerHTML;
}

export function copyComposerSelection(
  clipboard: DataTransfer,
  text: string,
  attachments: AttachmentSummary[],
  preview?: PreviewAttachment,
): Promise<ReadonlySet<string>> {
  const copy = createCopy(text, attachments, preview);
  const plainText = expandAttachmentReferences(expandChatTagReferences(expandComposerMentions(text)));
  clipboard.setData("text/plain", plainText);
  clipboard.setData("text/html", fragmentHtml(copy, plainText));
  return Promise.allSettled(copy.files.map((entry) => entry.file())).then(
    (results) =>
      new Set(
        copy.files.filter((_, index) => results[index]?.status === "fulfilled").map((entry) => entry.attachment.id),
      ),
  );
}

export async function copyMessageWithAttachments(
  body: string,
  plainText: string,
  attachments: AttachmentSummary[],
  preview?: PreviewAttachment,
): Promise<void> {
  const copy = createCopy(body, attachments, preview);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([fragmentHtml(copy, plainText)], { type: "text/html" }),
      }),
    ]);
  } catch {
    await writeClipboardText(plainText);
  }
}

export function readComposerCopy(clipboard: DataTransfer): PastedComposerCopy | null {
  const html = clipboard.getData("text/html");
  if (html.length > INPUT_LIMITS.messageText * 12) return null;
  const encoded = /data-openbot-composer-fragment=["']([^"']+)["']/u.exec(html)?.[1];
  if (!encoded) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (raw.length > 1024) return null;
  const value = Option.getOrNull(decodeFragment(raw));
  if (!value) return null;
  const copy = latestCopy;
  if (!copy || value.copyId !== copy.id) return null;
  return {
    text: copy.text,
    sourceIds: copy.files.map((entry) => entry.attachment.id),
    files: copy.files.map((entry) => entry.file()),
  };
}
