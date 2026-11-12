import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type ConversationMessage, isImageGenerationAspectRatio } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { getRecord, getString, type ThreadItem } from "../protocol";

export function isImageGenerationItem(item: ThreadItem): boolean {
  return item.type === "image_generation_call" || item.type === "imageGeneration";
}

/** A video that an agent made with a tool. Only the Grok media tools give one (`grok-media.ts`). */
export function isVideoGenerationItem(item: ThreadItem): boolean {
  return item.type === "videoGeneration";
}

export type GeneratedMediaKind = "image" | "video";

export function generatedMediaKind(item: ThreadItem): GeneratedMediaKind | null {
  if (isImageGenerationItem(item)) return "image";
  if (isVideoGenerationItem(item)) return "video";
  return null;
}

export function imageGenerationAspectRatio(item: ThreadItem) {
  const value = item.aspectRatio ?? item.aspect_ratio;
  return isImageGenerationAspectRatio(value) ? value : null;
}

export function imageGenerationFailure(item: ThreadItem): string | null {
  const failure = getRecord(item, "failure");
  return getString(failure, "message") ?? getString(item, "error") ?? getString(item, "failure");
}

export function generatedImageName(savedPath: string): string {
  const extension = savedPath.match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[1]?.toLowerCase() ?? "png";
  return `generated-image.${extension}`;
}

export function generatedVideoName(savedPath: string): string {
  const extension = savedPath.match(/\.(mp4|webm|mov)$/i)?.[1]?.toLowerCase() ?? "mp4";
  return `generated-video.${extension}`;
}

export function decodeGeneratedImage(value: string): Uint8Array {
  const payload = value.match(/^data:[^,]+,([\s\S]*)$/)?.[1] ?? value;
  const maxEncodedBytes = Math.ceil((ATTACHMENT_LIMITS.fileBytes * 4) / 3) + 8;
  if (payload.length > maxEncodedBytes || payload.length % 4 === 1) {
    throw new Error("Generated image exceeds the 100 MB limit.");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error("Generated image data is invalid.");
  }
  const bytes = Buffer.from(payload, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) {
    throw new Error("Generated image data is invalid or too large.");
  }
  return bytes;
}

/** The image or video info of a generation message, or null for another message. */
export function generatedMediaInfo(
  message: ConversationMessage,
): { kind: GeneratedMediaKind; info: { error?: string | undefined } } | null {
  if (message.itemType === "image_generation" && message.imageGeneration)
    return { kind: "image", info: message.imageGeneration };
  if (message.itemType === "video_generation" && message.videoGeneration)
    return { kind: "video", info: message.videoGeneration };
  return null;
}

export function generationInterruptedText(kind: GeneratedMediaKind): string {
  return kind === "video"
    ? sourceText("error.backend.videoGenerationInterrupted")
    : "Image generation was interrupted.";
}

export function markIncompleteMediaGeneration(
  message: ConversationMessage,
  status: ConversationMessage["status"],
): void {
  const media = generatedMediaInfo(message);
  if (!media) return;
  if (status === "interrupted") {
    media.info.error ??= generationInterruptedText(media.kind);
    return;
  }
  if (!message.attachments?.length) {
    media.info.error ??=
      media.kind === "video"
        ? sourceText("error.backend.videoGenerationNoVideo")
        : "Image generation did not return an image.";
    if (status === "completed") message.status = "failed";
  }
}
