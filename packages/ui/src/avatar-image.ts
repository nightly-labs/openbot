import { AVATAR_MIME_TYPES } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarImageInput } from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { currentText } from "./text";

const OUTPUT_SIZES = [512, 448, 384, 320] as const;
const OUTPUT_QUALITIES = [0.88, 0.82, 0.76, 0.7] as const;

const AVATAR_SOURCE_TYPES = [...AVATAR_MIME_TYPES, "image/gif"] as const;

interface AnimationFrame {
  data: Blob;
  durationMs: number;
}

export async function normalizeAvatarFile(file: File): Promise<AvatarImageInput> {
  if (!isOneOf(AVATAR_SOURCE_TYPES, file.type)) throw new Error(currentText().t("app.avatar.type"));
  if (file.size > AVATAR_IMAGE_LIMITS.sourceBytes) {
    throw new Error(currentText().t("app.avatar.size"));
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const animated = isAnimatedWebp(bytes) || (file.type === "image/gif" && typeof ImageDecoder !== "undefined");
  const source = animated ? null : await createImageBitmap(file);
  try {
    for (const [index, outputSize] of OUTPUT_SIZES.entries()) {
      const quality = OUTPUT_QUALITIES[index] ?? 0.7;
      const blob = source
        ? await renderAvatar(source, source.width, source.height, outputSize, quality)
        : await renderAnimatedAvatar(bytes, file.type, outputSize, quality);
      if (blob && blob.size <= AVATAR_IMAGE_LIMITS.storedBytes) {
        return {
          mimeType: "image/webp",
          bytes: new Uint8Array(await blob.arrayBuffer()),
        };
      }
    }
  } finally {
    source?.close();
  }
  throw new Error(currentText().t("app.avatar.tooLarge"));
}

export function avatarImageDataUrl(image: AvatarImageInput): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < image.bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...image.bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${image.mimeType};base64,${btoa(binary)}`;
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 16));
  return header.startsWith("RIFF") && header.endsWith("WEBPVP8X") && ((bytes[20] ?? 0) & 0x02) !== 0;
}

async function renderAnimatedAvatar(
  bytes: Uint8Array,
  type: string,
  outputSize: number,
  quality: number,
): Promise<Blob | null> {
  const decoder = new ImageDecoder({ data: bytes, type });
  try {
    await decoder.tracks.ready;
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    const frames: AnimationFrame[] = [];
    let frameBytes = 0;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      try {
        const still = await renderAvatar(image, image.displayWidth, image.displayHeight, outputSize, quality);
        if (frameCount === 1) return still;
        const data = await frameData(still);
        frameBytes += data.size;
        if (frameBytes > AVATAR_IMAGE_LIMITS.storedBytes) return null;
        frames.push({ data, durationMs: Math.round((image.duration ?? 0) / 1000) });
      } finally {
        image.close();
      }
    }
    return animatedWebp(frames, outputSize);
  } finally {
    decoder.close();
  }
}

async function frameData(still: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await still.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const chunks: Blob[] = [];
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const size = view.getUint32(offset + 4, true);
    const next = offset + 8 + size + (size % 2);
    const fourCC = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (fourCC === "ALPH" || fourCC === "VP8 " || fourCC === "VP8L") chunks.push(still.slice(offset, next));
    offset = next;
  }
  return new Blob(chunks);
}

function animatedWebp(frames: readonly AnimationFrame[], size: number): Blob {
  const extent = [...littleEndian(size - 1, 3), ...littleEndian(size - 1, 3)];
  const body = new Blob([
    chunk("VP8X", Uint8Array.of(0x12, 0, 0, 0, ...extent)),
    chunk("ANIM", new Uint8Array(6)),
    ...frames.map(({ data, durationMs }) =>
      chunk("ANMF", new Blob([Uint8Array.of(0, 0, 0, 0, 0, 0, ...extent, ...littleEndian(durationMs, 3), 0x02), data])),
    ),
  ]);
  return new Blob(["RIFF", Uint8Array.from(littleEndian(body.size + 4, 4)), "WEBP", body], { type: "image/webp" });
}

function chunk(fourCC: string, payload: Blob | Uint8Array<ArrayBuffer>): Blob {
  const size = payload instanceof Blob ? payload.size : payload.byteLength;
  return new Blob([fourCC, Uint8Array.from(littleEndian(size, 4)), payload, new Uint8Array(size % 2)]);
}

function littleEndian(value: number, byteLength: number): number[] {
  return Array.from({ length: byteLength }, (_, index) => (value >>> (8 * index)) & 0xff);
}

function avatarCrop(width: number, height: number): { sourceX: number; sourceY: number; sourceSize: number } {
  const sourceSize = Math.min(width, height);
  return {
    sourceX: Math.max(0, (width - sourceSize) / 2),
    sourceY: Math.max(0, (height - sourceSize) / 2),
    sourceSize,
  };
}

async function renderAvatar(
  source: CanvasImageSource,
  width: number,
  height: number,
  outputSize: number,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(currentText().t("app.avatar.processingUnavailable"));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const crop = avatarCrop(width, height);
  context.drawImage(source, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, outputSize, outputSize);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error(currentText().t("app.avatar.processFailed"));
  return blob;
}
