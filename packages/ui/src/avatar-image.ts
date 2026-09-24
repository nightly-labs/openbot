import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarImageInput } from "@openbot/contracts/ipc";

const OUTPUT_SIZES = [512, 448, 384, 320] as const;
const OUTPUT_QUALITIES = [0.88, 0.82, 0.76, 0.7] as const;

interface AnimationFrame {
  /** The ALPH, VP8 and VP8L chunks of one resized frame. */
  data: Blob;
  durationMs: number;
}

export async function normalizeAvatarFile(file: File): Promise<AvatarImageInput> {
  if (!isAvatarMimeType(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > AVATAR_IMAGE_LIMITS.sourceBytes) {
    throw new Error("Choose an image smaller than 10 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = isAnimatedWebp(bytes) ? null : await createImageBitmap(file);
  try {
    for (const [index, outputSize] of OUTPUT_SIZES.entries()) {
      const quality = OUTPUT_QUALITIES[index] ?? 0.7;
      const blob = source
        ? await renderAvatar(source, source.width, source.height, outputSize, quality)
        : await renderAnimatedAvatar(bytes, outputSize, quality);
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
  throw new Error("OpenBot could not make this image small enough. Choose a simpler image.");
}

/** A RIFF WebP with a VP8X header whose animation flag is set. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  const header = String.fromCharCode(...bytes.subarray(0, 16));
  return header.startsWith("RIFF") && header.endsWith("WEBPVP8X") && ((bytes[20] ?? 0) & 0x02) !== 0;
}

/**
 * Resizes each frame on its own, because a canvas keeps only the first frame of an animation.
 * Returns null as soon as the frames pass the stored size limit, so a large file does not encode
 * every frame again for each output size.
 */
async function renderAnimatedAvatar(bytes: Uint8Array, outputSize: number, quality: number): Promise<Blob | null> {
  const decoder = new ImageDecoder({ data: bytes, type: "image/webp" });
  try {
    await decoder.tracks.ready;
    const frames: AnimationFrame[] = [];
    let frameBytes = 0;
    for (let frameIndex = 0; frameIndex < (decoder.tracks.selectedTrack?.frameCount ?? 0); frameIndex++) {
      const { image } = await decoder.decode({ frameIndex });
      try {
        const still = await renderAvatar(image, image.displayWidth, image.displayHeight, outputSize, quality);
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

/**
 * The image chunks of a still WebP file, which is all one ANMF frame may hold. The canvas encoder
 * also writes VP8X and an sRGB ICCP profile, and sRGB is what a WebP without a profile means.
 */
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

/** Joins square frames into one animated WebP, laid out as the WebP container specification sets. */
function animatedWebp(frames: readonly AnimationFrame[], size: number): Blob {
  const extent = [...littleEndian(size - 1, 3), ...littleEndian(size - 1, 3)];
  const body = new Blob([
    // Alpha (0x10) and animation (0x02) flags, then the canvas size.
    chunk("VP8X", Uint8Array.of(0x12, 0, 0, 0, ...extent)),
    // A transparent background, and loop count 0 to repeat forever.
    chunk("ANIM", new Uint8Array(6)),
    // Each frame fills the canvas from 0,0 and replaces it (0x02: do not blend).
    ...frames.map(({ data, durationMs }) =>
      chunk("ANMF", new Blob([Uint8Array.of(0, 0, 0, 0, 0, 0, ...extent, ...littleEndian(durationMs, 3), 0x02), data])),
    ),
  ]);
  return new Blob(["RIFF", Uint8Array.from(littleEndian(body.size + 4, 4)), "WEBP", body], { type: "image/webp" });
}

/** A RIFF chunk. A payload of odd size gets one padding byte. */
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
  if (!context) throw new Error("Image processing is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const crop = avatarCrop(width, height);
  context.drawImage(source, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, outputSize, outputSize);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("OpenBot could not process this image.");
  return blob;
}
