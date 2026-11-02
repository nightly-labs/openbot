import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "입력이 필요해요.",
  "notification.needsApproval": "승인이 필요해요.",
  "notification.needsBrowserStep": "브라우저에서 직접 마무리할 단계가 있어요.",
  "notification.needsApprovalFor": "승인이 필요해요: {action}",
  "notification.finished": "작업을 마쳤어요.",
  "notification.failed": "오류로 중단됐어요.",
  "notification.channelTitle": "{channel}의 {agent}",
  "notification.channelMessage": "메시지를 보냈어요.",
  "notification.usageLimit.title": "{provider} 계정이 한도에 도달했어요",
  "notification.usageLimit.body": { other: "에이전트 {count}개가 대기 중이에요. OpenBot이 나중에 다시 시도할게요." },
  "notification.usageLimit.bodyResets": { other: "에이전트 {count}개가 대기 중이에요. {reset}에 초기화돼요." },
  "notification.machineAlert.disk": "{server}: 디스크 사용량 {percent}",
  "notification.machineAlert.memory": "{server}: 메모리 사용량 {percent}",
  "notification.machineAlert.cpu": "{server}: CPU 사용량 {percent}",
  "notification.machineAlert.body": "알림 기준치({level})를 넘었어요. 서버 설정 > 저장 공간을 확인해 보세요.",
  "notification.test": "알림이 정상적으로 작동해요.",
  "notification.welcome": "에이전트가 도움을 필요로 하면 OpenBot이 여기서 알려드려요.",
  "notification.toast.region": "알림",
  "notification.toast.close": "알림 닫기",
} as const satisfies PartialTranslation<typeof source>;
