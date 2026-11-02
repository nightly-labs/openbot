// The files of the WhatsApp account connection on this computer: where a downloaded file goes and
// under which name, which files an agent may send, and how WhatsApp shows a file that is sent.

import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep } from "node:path";
import { Effect } from "effect";
import {
  type WhatsAppAccountOperationError,
  whatsappAccountCall,
  whatsappToolFailure,
} from "./whatsapp-account-effects";
import type { WhatsAppStoredAttachment, WhatsAppStoredMessage } from "./whatsapp-account-history";

/** WhatsApp takes documents up to 2 GB. */
export const WHATSAPP_MAX_SEND_BYTES = 2000 * 1024 * 1024;

/** How an agent asks WhatsApp to show a file. `auto` chooses from the file's extension. */
export type WhatsAppSendFileKind = "auto" | "photo" | "document" | "voice" | "audio" | "video" | "video_note";

/** The MIME type of each extension that WhatsApp shows as something other than a plain file. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".webm": "video/webm",
  ".ogg": "audio/ogg; codecs=opus",
  ".opus": "audio/ogg; codecs=opus",
  ".oga": "audio/ogg; codecs=opus",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".amr": "audio/amr",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** The extension of each MIME type that a downloaded file without a name gets. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/3gpp": ".3gp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/amr": ".amr",
  "application/pdf": ".pdf",
};

/** Letters, digits, spaces, dots, dashes and underscores only, with no leading dot. */
function safeName(value: string, limit: number): string {
  return value
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .replace(/^[.\s]+/u, "")
    .slice(0, limit);
}

/** The folder of one chat in the download folder, such as `48600100200` or `120363000000000001_g.us`. */
export function whatsappChatFolder(directory: string, chat: string): string {
  const name = safeName(chat.replace(/@s\.whatsapp\.net$/u, "").replace(/@/gu, "_"), 80) || "chat";
  return join(directory, name);
}

/**
 * The name under which a downloaded file is saved: `<message id>-<file name>`, or
 * `<message id>-<kind><extension>` for a file with no name. A name from the sender cannot leave the
 * chat folder or hide as a dotfile.
 */
export function whatsappAttachmentFileName(
  message: WhatsAppStoredMessage,
  attachment: WhatsAppStoredAttachment,
): string {
  const id = safeName(message.id, 64) || "message";
  if (attachment.fileName) {
    const clean = safeName(attachment.fileName, 120);
    if (clean) return `${id}-${clean}`;
  }
  const mime = attachment.mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return `${id}-${attachment.kind}${EXTENSIONS[mime] ?? ""}`;
}

/** Whether `path` is `directory` or a path in it. */
function inside(directory: string, path: string): boolean {
  const rest = relative(directory, path);
  return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}

/**
 * The real path of a file that an agent asks to send. It must be an absolute path to a regular,
 * non-empty file of at most 2 GB, outside OpenBot's data (`folders.protected`) and outside the hidden
 * folders of the home folder (`~/.ssh`, `~/.config` and the like), which keep keys and sessions. The
 * real path is checked, so a link into one of those folders is refused too.
 */
export const whatsappFileToSend = Effect.fn("whatsappFileToSend")(function* (
  path: string,
  folders: { protected: string; home: string },
): Effect.fn.Return<{ path: string; size: number }, WhatsAppAccountOperationError> {
  if (!isAbsolute(path))
    return yield* whatsappToolFailure(`"${path}" is not an absolute path. Give the full path of the file.`);
  const real = yield* whatsappAccountCall(() => realpath(path)).pipe(
    Effect.mapError(() => whatsappToolFailure(`No file at ${path}.`)),
  );
  const info = yield* whatsappAccountCall(() => stat(real));
  if (!info.isFile()) return yield* whatsappToolFailure(`${path} is not a file.`);
  if (info.size === 0) return yield* whatsappToolFailure(`${path} is empty.`);
  if (info.size > WHATSAPP_MAX_SEND_BYTES) return yield* whatsappToolFailure(`${path} is larger than 2 GB.`);
  const own = yield* whatsappAccountCall(() => realpath(folders.protected)).pipe(
    Effect.orElseSucceed(() => folders.protected),
  );
  const home = yield* whatsappAccountCall(() => realpath(folders.home)).pipe(Effect.orElseSucceed(() => folders.home));
  const inHome = inside(home, real) ? relative(home, real) : null;
  if (inside(own, real) || inHome?.startsWith("."))
    return yield* whatsappToolFailure(
      `${path} is in a folder that keeps keys or sessions. WhatsApp does not send files from it.`,
    );
  return { path: real, size: info.size };
});

export interface WhatsAppFileToSend {
  path: string;
  kind: "photo" | "video" | "video_note" | "voice" | "audio" | "document";
  mimeType: string;
  fileName: string;
}

/**
 * How WhatsApp shows `path`. `auto` sends an image as a photo, a video as a video, audio as an audio
 * file and anything else as a document. A kind that does not fit the file is refused, because
 * WhatsApp would show a broken message.
 */
export function whatsappOutgoingFile(path: string, kind: WhatsAppSendFileKind): WhatsAppFileToSend | string {
  const extension = extname(path).toLowerCase();
  const mimeType = MIME_TYPES[extension] ?? "application/octet-stream";
  const fileName = basename(path);
  const family = mimeType.split("/")[0];
  const chosen =
    kind !== "auto"
      ? kind
      : family === "image" && extension !== ".gif" && extension !== ".heic"
        ? "photo"
        : family === "video"
          ? "video"
          : family === "audio"
            ? "audio"
            : "document";
  if (chosen === "photo" && family !== "image")
    return `${fileName} is not an image. Send it with kind "document", or pass a JPEG, PNG or WebP file.`;
  if ((chosen === "video" || chosen === "video_note") && family !== "video")
    return `${fileName} is not a video. Send it with kind "document", or pass an MP4 file.`;
  if ((chosen === "voice" || chosen === "audio") && family !== "audio")
    return `${fileName} is not an audio file. Send it with kind "document", or pass an OGG (Opus), MP3 or M4A file.`;
  return { path, kind: chosen, mimeType, fileName };
}
