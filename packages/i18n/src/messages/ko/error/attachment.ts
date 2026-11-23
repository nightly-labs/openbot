import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "첨부 파일을 찾을 수 없어요.",
  "error.attachment.fileTooLarge": "파일이 100 MB 제한을 넘어요.",
  "error.attachment.namedFileTooLarge": "{name} 파일이 100 MB 제한을 넘어요.",
  "error.attachment.emptyFile":
    "{name} 파일이 비어 있거나 OpenBot이 읽을 수 없어요. 파일을 다시 저장한 뒤 다시 첨부하세요.",
  "error.attachment.totalTooLarge": "첨부 파일이 전체 250 MB 제한을 넘어요.",
  "error.attachment.unavailable": "이 파일은 더 이상 사용할 수 없어요.",
  "error.attachment.noApp":
    "이 컴퓨터의 어떤 앱도 이 파일을 열지 못했습니다. 파일을 다운로드한 다음 파일 관리자에서 여세요.",
  "error.attachment.tooMany": "파일은 최대 {limit}개까지 선택할 수 있어요.",
  "error.attachment.mediaUnsupported":
    "이 서버는 MP3 또는 MOV 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.emlUnsupported":
    "이 서버는 EML 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.zipUnsupported":
    "이 서버는 ZIP 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.mp4Unsupported":
    "이 서버는 MP4 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.svgUnsupported":
    "이 서버는 SVG 첨부 파일을 지원하지 않아요. 호스트에서 OpenBot을 업데이트한 후 다시 시도해 주세요.",
  "error.attachment.previewTooLarge": "파일이 100 MB 제한을 넘어요.",
} as const satisfies PartialTranslation<typeof source>;
