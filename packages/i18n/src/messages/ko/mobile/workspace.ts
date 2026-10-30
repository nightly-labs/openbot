import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "연결되지 않음",
  "mobile.workspace.status.online": "온라인",
  "mobile.workspace.status.offline": "오프라인",
  "mobile.workspace.status.error": "연결 오류",
  "mobile.workspace.status.reconnecting": "다시 연결 중",
  "mobile.workspace.status.attempt": "{limit}회 중 {attempt}회째 시도",
  "mobile.workspace.status.attemptPrefix": "시도 ",
  "mobile.workspace.status.retryIn": "{seconds}초 후 다시 시도",
  "mobile.workspace.section.agents": "에이전트",
  "mobile.workspace.error.directoryUnavailable": "서버 디렉터리를 사용할 수 없어요.",
  "mobile.workspace.error.sectionsLoadFailed": "섹션을 불러올 수 없어요. 다시 시도해 주세요.",
  "mobile.workspace.error.transportNotReady": "모바일 전송이 준비되지 않았어요.",
  "mobile.workspace.error.sectionsUnsupported": "이 호스트는 섹션 변경을 지원하지 않아요.",
  "mobile.workspace.error.leaveOwnServer": "참여한 원격 서버에서만 나갈 수 있어요.",
  "mobile.workspace.error.removeOwnedServerOnly": "소유자만 이 서버를 삭제할 수 있어요.",
  "mobile.workspace.error.agentNotOnHost": "이 호스트에 없는 에이전트예요.",
  "mobile.workspace.error.filesUnsupported":
    "이 호스트는 파일 관리를 지원하지 않아요. 호스트의 OpenBot을 업데이트해 주세요.",
  "mobile.workspace.error.agentUnavailableOnHost": "이 호스트에서 에이전트를 사용할 수 없어요.",
  "mobile.workspace.error.agentUnavailable": "에이전트를 사용할 수 없어요.",
  "mobile.workspace.error.formUnavailable": "이 양식은 더 이상 사용할 수 없어요.",
  "mobile.workspace.error.approvalInactive":
    "이 요청은 지금 대기 중이 아니에요. 다른 기기에서 응답했거나 작업이 중지되었어요.",
  "mobile.workspace.error.approvalOffline": "이 요청에 응답하려면 서버에 연결해 주세요.",
  "mobile.workspace.alert.preferencesTitle": "채팅 환경설정을 저장할 수 없어요",
  "mobile.workspace.alert.preferencesBody": "이전 환경설정을 유지했어요. 다시 시도해 주세요.",
  "mobile.workspace.alert.updateRequiredTitle": "업데이트 필요",
  "mobile.workspace.alert.updateRequiredUnread":
    "대화를 읽지 않음으로 표시하려면 이 데스크톱 서버를 업데이트해 주세요.",
  "mobile.workspace.alert.markUnreadTitle": "읽지 않음으로 표시할 수 없어요",
  "mobile.workspace.alert.markUnreadBody": "서버에 다시 연결하고 다시 시도해 주세요.",
  "mobile.workspace.alert.markAllReadTitle": "모두 읽음으로 표시할 수 없어요",
  "mobile.workspace.alert.markAllReadBody":
    "일부 채팅이 아직 읽지 않은 상태예요. 서버에 다시 연결하고 다시 시도해 주세요.",
  "mobile.workspace.alert.serverOrderTitle": "서버 순서를 저장할 수 없어요",
  "mobile.workspace.alert.serverOrderBody": "이전 순서를 유지했어요. 다시 시도해 주세요.",
  "mobile.workspace.error.connectFailed": "서버 연결에 실패했어요.",
  "mobile.workspace.error.disconnectFailed": "서버 연결이 정상적으로 해제되지 않았어요.",
  "mobile.workspace.error.queueEditRejected": "호스트가 이 수정을 수락하지 않았어요.",
} as const satisfies PartialTranslation<typeof source>;
