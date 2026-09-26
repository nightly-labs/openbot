import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.notFound": "添付ファイルが見つかりませんでした。",
  "error.attachment.fileTooLarge": "100 MB の上限を超えるファイルがあります。",
  "error.attachment.totalTooLarge": "添付ファイルの合計が 250 MB の上限を超えています。",
  "error.attachment.unavailable": "このファイルはもう利用できません。",
  "error.attachment.tooMany": "選択できるファイルは {limit} 個までです。",
  "error.attachment.mediaUnsupported":
    "このサーバーは MP3 または MOV の添付ファイルに対応していません。ホストの OpenBot をアップデートしてから、もう一度お試しください。",
  "error.attachment.emlUnsupported":
    "このサーバーは EML の添付ファイルに対応していません。ホストの OpenBot をアップデートしてから、もう一度お試しください。",
  "error.attachment.previewTooLarge": "ファイルが 100 MB の上限を超えています。",
} as const satisfies PartialTranslation<typeof source>;
