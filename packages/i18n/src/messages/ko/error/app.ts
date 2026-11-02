import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "외부 브라우저에서는 HTTP(S) 링크만 열 수 있어요.",
  "error.app.notificationsUnsupported": "이 시스템은 데스크톱 알림을 지원하지 않아요.",
  "error.app.notificationSettingsMissing": "이 시스템에는 알림 설정 페이지가 없어요.",
  "error.app.notReady": "OpenBot이 아직 준비되지 않았어요.",
  "error.app.macSecureStorageUnavailable": "macOS 보안 저장소를 사용할 수 없어요.",
  "error.app.secretStorageUnavailable": "시스템 비밀 저장소를 사용할 수 없어요.",
  "error.app.remoteIdentityUnavailable": "원격 호스트 ID를 사용할 수 없어요.",
  "error.app.iceServersMissing": "원격 Signal이 아직 ICE 서버를 제공하지 않았어요.",
  "error.app.finishLocalTest": "디스플레이를 전환하기 전에 로컬 테스트를 끝내 주세요.",
} as const satisfies PartialTranslation<typeof source>;
