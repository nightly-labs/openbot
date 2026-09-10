import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { AVATAR_MIME_TYPES, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import type { AvatarImageInput } from "@openbot/contracts/ipc";

const SIZE_ERROR =
  "The avatar exceeds 512 KB. Resize or compress a copy with your available tools, then retry with its path.";

/** Reads a prepared local avatar without changing the source file. */
export async function loadAvatarFile(path: string, workspacePath: string): Promise<AvatarImageInput> {
  const source = await readSource(resolve(workspacePath, path));
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, source));
  if (!mimeType) throw new Error("Choose a valid PNG, JPEG, or WebP avatar image.");
  return { mimeType, bytes: source };
}

async function readSource(path: string): Promise<Buffer> {
  const file = await open(path, "r").catch(() => {
    throw new Error("OpenBot could not open the avatar file. Use an existing local image path.");
  });
  try {
    const metadata = await file.stat();
    if (!metadata.isFile()) throw new Error("The avatar path must refer to a regular file.");
    if (metadata.size > AVATAR_IMAGE_LIMITS.storedBytes) throw new Error(SIZE_ERROR);
    const chunks: Buffer[] = [];
    // Bound the read even if the file grows after stat.
    for await (const chunk of file.createReadStream({ end: AVATAR_IMAGE_LIMITS.storedBytes, autoClose: false })) {
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength > AVATAR_IMAGE_LIMITS.storedBytes) throw new Error(SIZE_ERROR);
    return bytes;
  } finally {
    await file.close();
  }
}
