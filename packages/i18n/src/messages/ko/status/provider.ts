import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "다운로드가 중지되었어요. 다시 시도해 주세요.",
  "status.provider.downloadFailed": "다운로드에 실패했어요. 다시 시도해 주세요.",
  "status.provider.updateWaiting": "현재 턴이 끝나면 업데이트가 시작돼요.",
  "status.provider.confirmContinue": "계속",
  "status.provider.confirmCancel": "취소",
} as const satisfies PartialTranslation<typeof source>;
