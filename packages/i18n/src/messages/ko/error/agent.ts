import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "이 요청에서는 기록을 사용할 수 없어요. 최근 기록을 다시 읽거나, 채널 작업에는 channel_history를 사용하세요.",
  "error.agent.toolRequestInvalid":
    "도구 검색 인수가 올바르지 않아요. 선언된 스키마와 원래의 정규화된 도구 이름을 사용하세요.",
  "error.agent.approvalWhileDeleting": "에이전트를 삭제하는 중에는 승인할 수 없어요.",
  "error.agent.accessLocalOnly": "에이전트 접근 권한은 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.agent.duplicateCleanupFailed": "에이전트 복제에 실패했고 불완전한 사본을 제거할 수 없었어요.",
  "error.agent.commitEffectsFailed": "트랜잭션은 커밋되었지만 저장된 후속 작업이 실패했어요.",
  "error.agent.settingsLocalOnly": "에이전트 설정은 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.agent.skillsLocalOnly": "스킬은 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.agent.addLocalOnly": "에이전트는 실행하는 컴퓨터에서만 추가할 수 있어요.",
  "error.agent.joinedServerUpdate": "참여한 서버의 에이전트는 여기서 업데이트할 수 없어요.",
  "error.agent.searchQueryRequired": "검색어가 필요해요.",
  "error.agent.messageTooLong": "메시지가 너무 길어요.",
  "error.agent.messageOrAttachmentRequired": "메시지 또는 첨부 파일이 필요해요.",
  "error.agent.promptAnswersTooLong": "프롬프트 답변이 너무 길어요.",
  "error.agent.gone": "이 에이전트는 더 이상 없어요.",
  "error.agent.profileGenerationBusy": "프로필 생성이 바빠요. 잠시 후 다시 시도해 주세요.",
  "error.agent.initialMessageRequired": "첫 메시지가 필요해요.",
  "error.agent.initialMessageTooLong": "첫 메시지가 너무 길어요.",
  "error.agent.setupCleanupFailed": "에이전트 설정에 실패했고 불완전한 에이전트를 제거할 수 없었어요.",
  "error.agent.modelUnavailable": "선택한 에이전트 모델을 사용할 수 없어요.",
  "error.agent.modelProviderNotConnected":
    '선택한 에이전트 모델 "{model}"을(를) 사용할 수 없어요: {provider}에 연결되어 있지 않아요.',
  "error.agent.modelListEmpty":
    '선택한 에이전트 모델 "{model}"을(를) 사용할 수 없어요: {provider}에서 모델 목록이 비어 있어요. 마지막 오류: {detail}',
  "error.agent.modelListEmptyNoError":
    '선택한 에이전트 모델 "{model}"을(를) 사용할 수 없어요: {provider}에서 모델 목록이 비어 있어요.',
  "error.agent.modelNotInProviderList":
    '선택한 에이전트 모델 "{model}"을(를) 사용할 수 없어요: {provider}의 목록에 없어요.',
  "error.agent.modelProviderMismatch": "선택한 모델이 해당 제공자의 모델이 아니에요.",
  "error.agent.modelNotListed": '모델 "{model}"을(를) 사용할 수 없어요. 사용 가능한 모델: {models}.',
  "error.agent.providerNotListed":
    "지금 사용할 수 있는 {provider} 모델이 없어요. list_models를 호출해 사용 가능한 모델을 확인하세요.",
  "error.agent.reasoningEffortUnsupported":
    '모델 "{model}"은(는) 추론 강도 "{effort}"을(를) 지원하지 않아요. 지원하는 강도: {efforts}.',
  "error.agent.noStartingModelInSettings":
    "{provider}에 사용할 수 있는 모델이 없고, 로그인된 다른 제공자에도 없어요. 제공자에 로그인하거나 서버 설정 → 제공자에서 기본 제공자를 변경하세요.",
  "error.agent.noStartingModel":
    "{provider}에 사용할 수 있는 모델이 없고, 로그인된 다른 제공자에도 없어요. 제공자에 로그인하거나 제공자 및 권한에서 기본 제공자를 변경하세요.",
  "error.agent.waitBeforeProviderChange": "제공자를 변경하기 전에 진행 중인 턴과 대기열이 끝날 때까지 기다려 주세요.",
  "error.agent.waitForTasksBeforeProviderChange":
    "이 에이전트의 작업이 실행 중이에요. 제공자를 변경하기 전에 작업이 끝날 때까지 기다리거나 작업을 중지해 주세요.",
  "error.agent.waitBeforeClearContext": "새 채팅을 시작하기 전에 진행 중인 턴과 대기열이 끝날 때까지 기다려 주세요.",
  "error.agent.waitBeforeCompactContext": "컨텍스트를 압축하기 전에 진행 중인 턴과 대기열이 끝날 때까지 기다려 주세요.",
  "error.agent.compactContextUnavailable": "이 에이전트는 지금 컨텍스트를 압축할 수 없어요.",
  "error.agent.unknown": "알 수 없는 에이전트: {id}",
  "error.agent.onlyUserWidensSettings":
    "에이전트에게 전체 접근 권한을 주거나 컴퓨터 제어를 켤 수 있는 사람은 사용자뿐이에요. 사용자에게 에이전트 설정에서 변경해 달라고 요청하세요.",
  "error.agent.queuedMessageCreateFailed": "대기 중인 메시지를 만들 수 없어요.",
  "error.agent.messageUnavailable": "이 메시지는 더 이상 사용할 수 없어요.",
  "error.agent.hostLimit": "호스트 하나에는 에이전트를 최대 {limit}개까지 둘 수 있어요.",
  "error.agent.changedWhileDuplicating": "복제하는 동안 에이전트가 변경되었어요. 다시 시도해 주세요.",
  "error.agent.duplicatedAgentGone": "복제한 에이전트가 더 이상 없어요.",
  "error.agent.stateCorrupt": "에이전트 상태가 손상되었거나 더 새로운 OpenBot 버전의 것이에요. 덮어쓰지 않아요.",
  "error.agent.oldRoleField":
    "저장된 에이전트 프로필이 이전 role 필드를 사용해요. OpenBot을 시작하기 전에 데이터를 업데이트하세요.",
  "error.agent.duplicateIds": "에이전트 상태에 중복된 에이전트 ID가 있어요. 덮어쓰지 않아요.",
  "error.agent.copyNameFailed": "OpenBot이 고유한 에이전트 사본 이름을 만들지 못했어요.",
  "error.agent.endpointRemoved": "이 에이전트가 사용하던 엔드포인트가 제거되었어요. 다른 모델을 선택해 주세요.",
  "error.agent.turnStalled":
    "{provider}이(가) 응답하지 않아 OpenBot이 이 턴을 종료했어요. 메시지를 다시 보내거나 다른 모델을 선택해 주세요.",
  "error.agent.selectedGone": "선택한 에이전트가 더 이상 없어요.",
  "error.agent.profileEndpointsChanged": "생성하는 동안 사용자 지정 엔드포인트가 변경되었어요. 다시 시도해 주세요.",
  "error.agent.profileInvalid": "제공자가 올바르지 않은 프로필을 반환했어요. 프롬프트를 수정해 보세요.",
  "error.agent.profileSectionUnavailable": "생성된 섹션을 사용할 수 없어요. 다시 시도하거나 섹션을 직접 선택하세요.",
  "error.agent.profileTimedOut": "프로필 생성 시간이 초과되었어요. 다시 시도해 주세요.",
  "error.agent.profileDisconnected": "프로필을 생성하는 동안 제공자 연결이 끊어졌어요.",
  "error.agent.profileToolUse": "제공자가 도구를 사용하려 했어요. 프롬프트를 수정해 보세요.",
  "error.agent.profileFailed": "제공자가 프로필을 생성하지 못했어요. 다시 시도해 주세요.",
  "error.agent.profileTooLarge": "생성된 프로필이 너무 커요. 더 짧은 프롬프트를 사용해 보세요.",
  "error.agent.profileNotStarted": "제공자가 프로필 생성을 시작하지 못했어요.",
  "error.agent.deletionBusy": "에이전트를 이미 삭제하는 중이에요.",
  "error.agent.stopBeforeDelete": "삭제하기 전에 에이전트를 중지하고 대기 중인 메시지를 취소해 주세요.",
  "error.agent.deleteIncomplete": "에이전트 데이터를 완전히 제거하지 못했어요. 에이전트 삭제를 다시 시도해 주세요.",
  "error.agent.duplicationBusy": "이 에이전트를 이미 복제하는 중이에요.",
  "error.agent.waitBeforeDuplicate": "복제하기 전에 에이전트가 끝나고 대기열이 비워질 때까지 기다려 주세요.",
  "error.agent.saveOtherAgent": "이 저장은 다른 에이전트의 것이에요.",
  "error.agent.savedGone": "저장된 에이전트가 더 이상 없어요.",
  "error.agent.storedProfileUnreadable":
    '저장된 에이전트 프로필의 "{field}" 값을 읽을 수 없어요. OpenBot을 시작하기 전에 데이터를 업데이트하세요.',
  "error.agent.storedProfileUnreadableId":
    '저장된 에이전트 프로필 {id}의 "{field}" 값을 읽을 수 없어요. OpenBot을 시작하기 전에 데이터를 업데이트하세요.',
  "error.agent.queueEditRejected": "대기열 수정이 거부되었어요: {reason}",
  "error.agent.computerUseLocalOnly": "컴퓨터 제어는 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.agent.automationLocalOnly": "로컬 스크립트는 에이전트를 실행하는 컴퓨터에서만 허용할 수 있어요.",
  "error.agent.newChatLocalOnly":
    "에이전트가 새 채팅을 시작하도록 허용하는 것은 에이전트를 실행하는 컴퓨터에서만 할 수 있어요.",
  "error.agent.quickAcknowledgementLocalOnly": "이 설정은 에이전트를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.agent.sideQuestionBusy": "곁다리 질문이 너무 많이 실행 중이에요. 잠시 후 다시 시도해 주세요.",
  "error.agent.sideQuestionFailed": "에이전트가 곁다리 질문에 답하지 못했어요. 다시 시도해 주세요.",
  "error.agent.busyMessageModeLocalOnly":
    "에이전트가 작업 중일 때 메시지를 처리하는 방식은 에이전트를 실행하는 컴퓨터에서만 설정할 수 있어요.",
  "error.agent.backupModelsLocalOnly": "백업 모델은 에이전트를 실행하는 컴퓨터에서만 설정할 수 있어요.",
  "error.agent.taskLimitLocalOnly": "작업 한도는 에이전트를 실행하는 컴퓨터에서만 설정할 수 있어요.",
  "error.agent.localScriptsOff": "이 에이전트는 로컬 스크립트를 허용하지 않아요.",
  "error.agent.localScriptsRateLimited":
    "지난 1시간 동안 로컬 스크립트가 이 에이전트에게 메시지 또는 루틴 요청을 {limit}건 보냈어요. 나중에 다시 시도해 주세요.",
  "error.agent.automationOff": "이 에이전트는 로컬 스크립트가 루틴을 실행하도록 허용하지 않아요.",
  "error.agent.automationPayloadTooLong": "페이로드가 {limit}자를 넘어요.",
  "error.agent.automationRateLimited":
    "지난 1시간 동안 로컬 스크립트가 이 에이전트의 루틴을 {limit}번 실행했어요. 나중에 다시 시도해 주세요.",
  "error.agent.workspaceOnlyMacOnly":
    "이 제공자의 워크스페이스 전용 모드는 macOS에서만 사용할 수 있어요. 에이전트 설정에서 전체 접근 권한을 선택하세요.",
  "error.agent.lowMemory":
    "이 서버의 메모리가 부족해요. 메시지는 대기열에서 기다리다가 메모리가 확보되면 시작돼요. 더 큰 플랜을 쓰면 서버 메모리가 늘어나요.",
  "error.agent.lowMemoryServer":
    "이 서버의 메모리가 부족해요. 메시지는 대기열에서 기다리다가 메모리가 확보되면 시작돼요.",
  "error.agent.workspaceOnlyToolMissing":
    "워크스페이스 전용 모드에는 {tool}이(가) 필요한데 OpenBot이 찾지 못했어요. 설치하거나 에이전트 설정에서 전체 접근 권한을 선택하세요.",
  "error.agent.claudeSandboxUnavailable":
    "워크스페이스 전용 모드에는 Claude 샌드박스가 필요하지만 이 컴퓨터에서는 Claude가 샌드박스를 시작할 수 없어요: {reason}. 에이전트 설정에서 전체 접근 권한이나 다른 제공자를 선택하세요.",
  "error.agent.screenCaptureOff":
    "이 에이전트는 화면 캡처가 꺼져 있어요. 사용자가 에이전트 설정에서 컴퓨터 제어를 켤 수 있어요.",
  "error.agent.screenCaptureUnavailable": "이 컴퓨터에서는 화면 캡처를 사용할 수 없어요.",
  "error.agent.screenCaptureShared":
    "Slack, Discord, Telegram 대화에서는 다른 사람도 파일을 받으므로 화면 캡처를 사용할 수 없어요.",
  "error.agent.screenCaptureDeclined": "사용자가 이 화면 캡처를 허용하지 않았어요. 캡처된 내용은 없어요.",
  "error.agent.mcpServerDeclined": "사용자가 이 MCP 서버 변경을 허용하지 않았어요. 변경된 내용은 없어요.",
  "error.agent.mcpServerNotSaved": "MCP 서버가 응답하지 않아 저장하지 않았어요. {error}",
  "error.agent.mcpServerKeysMove":
    "MCP 서버 {name}에는 현재 서버용 키가 있어요. 사용자에게 서버 설정의 MCP에서 주소, 명령, 인수 또는 전송 방식을 변경해 달라고 요청하세요.",
  "error.agent.mcpServerUnknown": "{name}(이)라는 MCP 서버가 없어요. list_mcp_servers를 호출해 이름을 확인하세요.",
  "error.agent.screenCaptureWindowMissing":
    "해당 창이 지금 열려 있지 않아요. list_capture_sources를 호출해 현재 창 ID를 확인하세요.",
  "error.agent.screenCaptureDisplayMissing":
    "해당 디스플레이가 지금 연결되어 있지 않아요. list_capture_sources를 호출해 현재 디스플레이 ID를 확인하세요.",
  "error.agent.screenCaptureRegionOutside":
    "해당 영역이 하나의 디스플레이 안에 있지 않아요. list_capture_sources에서 가져온 한 디스플레이 범위 안의 데스크톱 포인트를 사용하세요.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot에 화면 녹화 권한이 없어요. 사용자에게 시스템 설정 > 개인정보 보호 및 보안 > 화면 및 시스템 오디오 녹화를 열어 OpenBot을 켠 다음, OpenBot을 종료했다가 다시 열도록 요청하세요.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows가 빈 이미지를 반환했어요. 사용자에게 컴퓨터 잠금을 해제하고 보호된 콘텐츠를 닫도록 요청하세요. 조직의 정책이 화면 캡처를 막을 수도 있어요.",
  "error.agent.screenCaptureFailed": "화면 캡처에 실패했어요. 다시 시도해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
