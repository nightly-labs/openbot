import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "작업 중이에요…",
  "status.messaging.queued": "대기 중: OpenBot이 다른 요청을 처리하고 있어요. 답변은 여기에 올라와요.",
  "status.messaging.busy": "대기 중인 요청이 너무 많아요. 나중에 다시 시도해 주세요.",
  "status.messaging.failed": "OpenBot이 이 요청을 끝내지 못했어요. 자세한 내용은 OpenBot 호스트에서 확인하세요.",
  "status.messaging.noAnswer": "OpenBot이 텍스트 답변 없이 작업을 마쳤어요.",
  "status.messaging.noAgent":
    "아직 여기서 답변할 수 있는 에이전트가 없어요. OpenBot에서 Slack Orchestrator를 추가하세요.",
  "status.messaging.delegated": "팀원이 작업 중이에요. 답변은 여기에 올라와요.",
  "status.messaging.stopped": "중지됨",
  "status.messaging.stop": "중지",
  "status.messaging.approvalTitle": "OpenBot이 계속 진행하려면 승인이 필요해요.",
  "status.messaging.approvalCommand": "명령 실행",
  "status.messaging.approvalFileChange": "파일 변경",
  "status.messaging.approvalPermissions": "추가 권한 받기",
  "status.messaging.approve": "승인",
  "status.messaging.deny": "거부",
  "status.messaging.approvedBy": "{user} 님이 승인했어요.",
  "status.messaging.deniedBy": "{user} 님이 거부했어요.",
  "status.messaging.answeredOnHost": "OpenBot 호스트에서 답변했어요.",
  "status.messaging.requestInactive": "이 요청은 더 이상 유효하지 않아요.",
  "status.messaging.onlyRequester": "{user} 님만 할 수 있어요. OpenBot 호스트에서도 답변할 수 있어요.",
  "status.messaging.hostOnly": "OpenBot 호스트에서만 이 요청에 답변할 수 있어요.",
  "status.messaging.filesSkipped": "일부 파일을 보내지 못했어요: {names}.",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Slack에서 답변하고 팀에 요청해요",
  "status.messaging.discordNoAgent":
    "아직 여기서 답변할 수 있는 에이전트가 없어요. OpenBot에서 Discord Orchestrator를 추가하세요.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Discord에서 답변하고 팀에 요청해요",
  "status.messaging.integrationsSection": "연동",
  "status.messaging.signInReceived": "OpenBot이 Slack 설치를 받았어요. 이 탭을 닫아도 돼요.",
  "status.messaging.signInUnknown": "OpenBot이 시작한 Slack 설치가 아니에요. OpenBot에서 다시 시작해 주세요.",
  "status.messaging.telegramNoAgent":
    "아직 여기서 답변할 수 있는 에이전트가 없어요. OpenBot에서 Telegram Orchestrator를 추가하세요.",
  "status.messaging.telegramLinked":
    "OpenBot이 이 채팅에 연결되었어요. {bot}을(를) 멘션하거나 OpenBot의 메시지에 답장해서 에이전트에게 요청하세요.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Telegram에서 답변하고 팀에 요청해요",
  "status.messaging.whatsappNoAgent":
    "아직 여기서 답변할 수 있는 에이전트가 없어요. OpenBot에서 WhatsApp Orchestrator를 추가하세요.",
  "status.messaging.whatsappApprovalMenu": "승인하려면 1, 거부하려면 2로 답장하세요.",
  "status.messaging.whatsappStopMenu": "중지하려면 “stop”으로 답장하세요.",
  "status.messaging.whatsappPairingCode":
    "이 번호는 소유자가 허용한 사람에게만 답해요. 소유자에게 이 코드를 알려 주세요: {code}",
  "status.messaging.whatsappPairingApproved": "이제 이 번호로 요청을 보낼 수 있어요.",
  "status.messaging.whatsappOwnChat": "나에게 메시지 보내기",
  "status.messaging.whatsappOrchestratorName": "WhatsApp Orchestrator",
  "status.messaging.whatsappOrchestratorTitle": "WhatsApp에서 답변하고 팀에 요청해요",
} as const satisfies PartialTranslation<typeof source>;
