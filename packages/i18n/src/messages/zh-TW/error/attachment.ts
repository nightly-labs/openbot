import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.notFound": "未找到該附件。",
  "error.attachment.fileTooLarge": "某個檔案超過了 100 MB 上限。",
  "error.attachment.totalTooLarge": "附件總量超過了 250 MB 上限。",
  "error.attachment.unavailable": "該檔案已不可用。",
  "error.attachment.tooMany": "最多隻能選擇 {limit} 個檔案。",
  "error.attachment.mediaUnsupported": "該伺服器不支援 MP3 或 MOV 附件。請更新主機上的 OpenBot 後重試。",
  "error.attachment.emlUnsupported": "該伺服器不支援 EML 附件。請更新主機上的 OpenBot 後重試。",
  "error.attachment.zipUnsupported": "該伺服器不支援 ZIP 附件。請更新主機上的 OpenBot 後重試。",
  "error.attachment.mp4Unsupported": "該伺服器不支援 MP4 附件。請更新主機上的 OpenBot 後重試。",
  "error.attachment.previewTooLarge": "該檔案超過了 100 MB 上限。",
} as const satisfies PartialTranslation<typeof source>;
