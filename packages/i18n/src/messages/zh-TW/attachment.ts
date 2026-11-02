import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "開啟檔案",
  "attachment.preview": "預覽 {name}",
  "attachment.notFound": "未找到檔案",
  "attachment.download": "下載 {name}",
  "attachment.open": "開啟 {name}",
  "attachment.loadMedia": "播放 {name}",
  "attachment.previewUnavailable": "預覽不可用。",
  "attachment.error.preview": "無法預覽 {name}，請重試。",
  "attachment.error.download": "無法下載附件，請重試。",
  "attachment.error.open": "無法開啟或儲存該附件，請重試。",
  "attachment.error.openFile": "無法開啟該檔案，請重試。",
  "attachment.error.fileFallback": "檔案",
  "attachment.error.fileNotFound": "在該路徑下找不到「{name}」，它可能已被移動或刪除。",
  "attachment.error.previewFile": "無法預覽「{name}」，請重試。",
} as const satisfies PartialTranslation<typeof source>;
