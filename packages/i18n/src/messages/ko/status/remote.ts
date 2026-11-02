import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "권한 설정은 macOS에서만 사용할 수 있어요.",
  "status.remote.setupInstallHost": "원격 데스크톱 호스트 구성 요소를 설치한 후 다시 확인해 주세요.",
  "status.remote.setupUpdateRuntime": "macOS 권한을 확인하려면 원격 데스크톱 런타임을 업데이트해 주세요.",
  "status.remote.setupCheckFailed":
    "Sunshine이 권한 확인을 완료하지 못했어요. 호스트 세션을 확인한 후 다시 시도해 주세요.",
  "status.remote.setupServiceFailed":
    "원격 데스크톱 서비스를 시작할 수 없어요. 이 macOS 사용자에게 활성 GUI 세션이 있는지 확인해 주세요.",
  "status.remote.connectingSunshine": "Sunshine으로 연결 중…",
  "status.remote.switchingMonitor": "공유 모니터 전환 중…",
  "status.remote.controlConnected": "원격 제어에 연결했어요.",
  "status.remote.controlFailed": "원격 제어에 실패했어요.",
  "status.remote.stagePreferences": "로컬 채팅 환경설정 불러오는 중: {reason}",
  "status.remote.stageConnection": "데스크톱에 연결 중: {reason}",
  "status.remote.stageCompatibility": "데스크톱 호환성 확인 중: {reason}",
  "status.remote.stageAgents": "에이전트 불러오는 중: {reason}",
  "status.remote.stageReads": "읽음 상태 불러오는 중: {reason}",
  "status.remote.suspendedDetail": "연결하기 전에 OpenBot Mobile 또는 데스크톱 앱을 업데이트해 주세요.\n{detail}",
  "status.remote.cooldownDetail":
    "{limit}번 시도했지만 연결하지 못했어요. {minutes}:{seconds} 후 다시 시도해요.\n{detail}",
  "status.remote.cooldown": "{limit}번 시도했지만 연결하지 못했어요. {minutes}:{seconds} 후 다시 시도해요.",
  "status.remote.connectionLostDetail": { other: "연결이 끊어졌어요. {count}초 후 다시 시도해요.\n{detail}" },
  "status.remote.connectionLost": { other: "연결이 끊어졌어요. {count}초 후 다시 시도해요." },
  "status.remote.attemptFailedDetail": { other: "연결 시도에 실패했어요. {count}초 후 다시 시도해요.\n{detail}" },
  "status.remote.attemptFailed": { other: "연결 시도에 실패했어요. {count}초 후 다시 시도해요." },
  "status.remote.reconnectingDetail": { other: "다시 연결 중 {attempt}/{count}\n{detail}" },
  "status.remote.reconnecting": { other: "다시 연결 중 {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
