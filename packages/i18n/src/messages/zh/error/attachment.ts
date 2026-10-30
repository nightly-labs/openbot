import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.notFound": "未找到该附件。",
  "error.attachment.fileTooLarge": "某个文件超过了 100 MB 上限。",
  "error.attachment.totalTooLarge": "附件总量超过了 250 MB 上限。",
  "error.attachment.unavailable": "该文件已不可用。",
  "error.attachment.tooMany": "最多只能选择 {limit} 个文件。",
  "error.attachment.mediaUnsupported": "该服务器不支持 MP3 或 MOV 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.emlUnsupported": "该服务器不支持 EML 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.zipUnsupported": "该服务器不支持 ZIP 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.mp4Unsupported": "该服务器不支持 MP4 附件。请更新主机上的 OpenBot 后重试。",
  "error.attachment.previewTooLarge": "该文件超过了 100 MB 上限。",
} as const satisfies PartialTranslation<typeof source>;
