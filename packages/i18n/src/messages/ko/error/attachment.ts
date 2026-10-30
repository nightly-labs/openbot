import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "첨부 파일을 찾을 수 없어요.",
  "error.attachment.fileTooLarge": "파일이 100 MB 제한을 넘어요.",
  "error.attachment.totalTooLarge": "첨부 파일이 전체 250 MB 제한을 넘어요.",
  "error.attachment.unavailable": "이 파일은 더 이상 사용할 수 없어요.",
  "error.attachment.tooMany": "파일은 최대 {limit}개까지 선택할 수 있어요.",
  "error.attachment.mediaUnsupported":
    "이 서버는 MP3 또는 MOV 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.emlUnsupported":
    "이 서버는 EML 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.zipUnsupported":
    "이 서버는 ZIP 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.mp4Unsupported":
    "이 서버는 MP4 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.previewTooLarge": "파일이 100 MB 제한을 넘어요.",
} as const satisfies PartialTranslation<typeof source>;
