import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "이 서버는 저장소를 지원하지 않아요.",
  "error.storage.agentMissing": "에이전트가 없어요.",
  "error.storage.unreadableFile": "OpenBot이 {path} 파일을 읽을 수 없어요. 파일이 손상되었어요.",
} as const satisfies PartialTranslation<typeof source>;
