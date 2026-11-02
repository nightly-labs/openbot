import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "원격 Signal이 ICE 서버를 제공하지 않았어요.",
  "error.host.keyRotationUnavailable": "이 서버는 계정 서비스 없이는 키를 변경할 수 없어요.",
  "error.host.keyRotationRefused": "계정 서비스가 새 서버 키를 수락하지 않았어요. 현재 키를 계속 사용해요.",
  "error.host.webRtcNotConfigured": "WebRTC 호스트 서비스가 설정되어 있지 않아요.",
  "error.host.runtimeNotInstalled": "원격 데스크톱 런타임이 설치되어 있지 않아요.",
  "error.host.setupUnavailable": "권한 설정을 사용할 수 없어요.",
  "error.host.accountChangedDuringUpdate": "이 서버를 업데이트하는 동안 로그인한 계정이 변경되었어요.",
  "error.host.nameBeforePublish": "이 OpenBot을 게시하기 전에 이름을 지정해 주세요.",
  "error.host.memberNotFound": "원격 멤버가 없어요.",
  "error.host.publishBeforeInvite": "초대를 만들기 전에 이 OpenBot을 공개해 주세요.",
  "error.host.teamAccessUnavailable": "팀 접근 권한을 사용할 수 없어요.",
  "error.host.ownerIdentityUnavailable": "호스트 소유자 ID를 사용할 수 없어요.",
  "error.host.reserveAddressFailed": "공개 주소를 예약할 수 없어요.",
  "error.host.publishFailed": "이 OpenBot을 게시할 수 없어요.",
  "error.host.mobileConnectPublishFailed": "모바일 연결용으로 이 OpenBot을 게시할 수 없어요.",
  "error.host.mobileConnectHostChanged": "모바일 연결 호스트가 변경되었어요. 다시 시도해 주세요.",
  "error.host.noServer": "이 컴퓨터에는 변경할 서버가 없어요.",
  "error.host.identityLocalOnly": "서버 이름과 로고는 서버를 실행하는 컴퓨터에서만 변경할 수 있어요.",
  "error.host.timezoneInvalid": "알 수 없는 시간대예요.",
  "error.host.maintenanceInterrupted":
    "호스트 유지 관리가 중단되었어요. 다시 시도하기 전에 애플리케이션을 확인하고 호스트 상태를 재설정해 주세요.",
  "error.host.updateFailed":
    "{phase} 중에 호스트 업데이트에 실패했어요. 상태를 재설정하기 전에 번들 소유권, 서명, 테넌트 상태, 여유 디스크 공간을 확인해 주세요.",
  "error.host.tenantsNotIdle": "2시간 안에 테넌트가 5분 동안 유휴 상태를 유지하지 않았어요.",
  "error.host.tenantShutdownTimeout": "테넌트 종료 시간이 초과되었어요. 애플리케이션 교체를 시작하지 않았어요.",
  "error.host.tenantHealthMissing":
    "다시 시작한 후 테넌트 상태 보고서가 없거나 비정상이에요. 다른 업데이트를 하기 전에 테넌트 세션을 점검해 주세요.",
} as const satisfies PartialTranslation<typeof source>;
