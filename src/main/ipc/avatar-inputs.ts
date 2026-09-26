import { isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import type { AvatarImageInput } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { isObject } from "./validation";

export function parseAvatarImage(value: unknown): AvatarImageInput | null {
  if (value === null) return null;
  if (
    !isObject(value) ||
    !isString(value.mimeType) ||
    !isAvatarMimeType(value.mimeType) ||
    !(value.bytes instanceof Uint8Array) ||
    !isValidAvatarImage(value.mimeType, value.bytes)
  ) {
    throw new Error(sourceText("error.team.logoInvalid"));
  }
  return { mimeType: value.mimeType, bytes: value.bytes };
}
