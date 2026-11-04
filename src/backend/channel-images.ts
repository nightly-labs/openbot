import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AvatarMimeType,
  avatarFileExtension,
  isAvatarMimeType,
  isValidAvatarImage,
} from "@openbot/contracts/avatar-images";
import type { AvatarImageInput, Channel } from "@openbot/contracts/ipc";
import { isUuidV4 } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { writeFileAtomically } from "./atomic-json-file";
import { channelFailure } from "./channel-effects";

export interface ChannelImageFile {
  path: string;
  mimeType: AvatarMimeType;
  version: string;
}

/**
 * The images that readers upload for channels, one file for each version, beside the agent
 * avatars. A channel id can hold any character, so its folder is a hash of the id.
 */
export class ChannelImages {
  constructor(readonly root: string) {}

  resolve(channel: Pick<Channel, "id" | "imageUrl">): ChannelImageFile | null {
    if (!channel.imageUrl) return null;
    const parsed = parseChannelImageUrl(channel.imageUrl, channel.id);
    if (!parsed) return null;
    return {
      path: join(this.#directory(channel.id), `${parsed.version}.${avatarFileExtension(parsed.mimeType)}`),
      ...parsed,
    };
  }

  /** Writes a new version and returns its URL. The caller stores the URL, then removes the old file. */
  readonly write = Effect.fn("ChannelImages.write")(function* (
    this: ChannelImages,
    channelId: string,
    image: AvatarImageInput,
  ) {
    if (!isValidAvatarImage(image.mimeType, image.bytes))
      return yield* Effect.fail(channelFailure(new Error(sourceText("error.team.logoInvalid"))));
    const version = randomUUID();
    const directory = this.#directory(channelId);
    const path = join(directory, `${version}.${avatarFileExtension(image.mimeType)}`);
    yield* Effect.tryPromise({
      try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
      catch: channelFailure,
    });
    yield* writeFileAtomically(path, image.bytes).pipe(Effect.mapError(({ cause }) => channelFailure(cause)));
    return { path, url: channelImageUrl(channelId, version, image.mimeType) };
  });

  /** A file that stays behind costs only disk space, so a failed removal is not an error. */
  remove(path: string): Effect.Effect<void> {
    return Effect.promise(() => rm(path, { force: true }).catch(() => undefined));
  }

  removeAll(channelId: string): Effect.Effect<void> {
    return Effect.promise(() =>
      rm(this.#directory(channelId), { recursive: true, force: true }).catch(() => undefined),
    );
  }

  #directory(channelId: string): string {
    return join(this.root, createHash("sha256").update(channelId).digest("hex"));
  }
}

function channelImageUrl(channelId: string, version: string, mimeType: AvatarMimeType): string {
  const url = new URL(`openbot-avatar://channel/${encodeURIComponent(channelId)}`);
  url.searchParams.set("v", version);
  url.searchParams.set("type", mimeType);
  return url.toString();
}

function parseChannelImageUrl(
  value: string,
  expectedChannelId: string,
): { version: string; mimeType: AvatarMimeType } | null {
  try {
    const url = new URL(value);
    const channelId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    const version = url.searchParams.get("v") ?? "";
    const mimeType = url.searchParams.get("type") ?? "";
    if (
      url.protocol !== "openbot-avatar:" ||
      url.hostname !== "channel" ||
      channelId !== expectedChannelId ||
      !isUuidV4(version) ||
      !isAvatarMimeType(mimeType)
    )
      return null;
    return { version, mimeType };
  } catch {
    return null;
  }
}
