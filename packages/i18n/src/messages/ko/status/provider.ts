import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "다운로드가 중지되었어요. 다시 시도해 주세요.",
  "status.provider.downloadFailed": "다운로드에 실패했어요. 다시 시도해 주세요.",
  "status.provider.updateWaiting": "현재 턴이 끝나면 업데이트가 시작돼요.",
  "status.provider.confirmContinue": "계속",
  "status.provider.confirmCancel": "취소",
  "status.provider.retryUnreachable": "{provider}이(가) 서버에 연결할 수 없습니다. 재시도 {attempt}/{maxAttempts}.",
  "status.provider.retryServerError": "{provider} 서버가 혼잡하거나 오류가 있습니다. 재시도 {attempt}/{maxAttempts}.",
  "status.provider.modelRetryUnreachable":
    "{provider}이(가) 모델 제공자에 연결할 수 없습니다. 다시 시도하는 중: {attempt}번째.",
  "status.provider.modelRetryServerError":
    "모델 제공자가 혼잡하거나 오류가 있습니다. {provider}이(가) 다시 시도하는 중: {attempt}번째.",
  "status.provider.modelRetryRecovered": "모델 제공자가 다시 응답합니다.",
  "status.provider.retryRecovered": "{provider}이(가) 서버에서 다시 응답을 받고 있습니다.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude가 표준 속도로 답했어요. Claude 구독에서 빠른 모드는 사용 크레딧을 써요. Claude 계정에서 켜 주세요.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude가 표준 속도로 답했어요. 사용 중인 Claude 요금제에는 빠른 모드가 없어요.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude가 표준 속도로 답했어요. 빠른 모드는 Anthropic API 키나 Claude 구독에서만 쓸 수 있고, Bedrock, Vertex, Foundry, 게이트웨이에서는 쓸 수 없어요.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude가 표준 속도로 답했어요. 이 모델은 계정에서 빠른 모드를 쓸 수 없어요.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude가 표준 속도로 답했어요. 빠른 모드가 Claude Code 설정에서 또는 조직에 의해 꺼져 있어요.",
  "status.provider.claudeFastModeUnavailable":
    "Claude가 표준 속도로 답했어요. Claude Code가 이번 턴에서 빠른 모드를 쓸 수 없었어요.",
  "status.provider.claudeOwnApiKey":
    "Claude Code가 Anthropic API 키를 사용하도록 설정되어 있습니다. Anthropic은 각 요청을 Claude 플랜이 아니라 키의 API 크레딧으로 청구합니다. 플랜을 사용하려면 Claude Code 설정 또는 환경 변수에서 키를 제거한 다음 OpenBot을 다시 시작하세요.",
} as const satisfies PartialTranslation<typeof source>;
