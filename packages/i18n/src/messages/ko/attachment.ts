import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "파일 열기",
  "attachment.preview": "{name} 미리 보기",
  "attachment.notFound": "파일을 찾을 수 없어요",
  "attachment.download": "{name} 다운로드",
  "attachment.open": "{name} 열기",
  "attachment.loadMedia": "{name} 재생",
  "attachment.previewUnavailable": "미리 볼 수 없어요.",
  "attachment.error.preview": "{name}을(를) 미리 보지 못했어요. 다시 시도해 주세요.",
  "attachment.error.download": "첨부 파일을 다운로드하지 못했어요. 다시 시도해 주세요.",
  "attachment.error.open": "이 첨부 파일을 열거나 저장하지 못했어요. 다시 시도해 주세요.",
  "attachment.error.openFile": "이 파일을 열지 못했어요. 다시 시도해 주세요.",
  "attachment.error.fileFallback": "파일",
  "attachment.error.fileNotFound": "이 경로에서 “{name}”을(를) 찾을 수 없어요. 이동되었거나 삭제되었을 수 있어요.",
  "attachment.error.previewFile": "“{name}”을(를) 미리 보지 못했어요. 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
