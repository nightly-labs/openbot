import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "이 OpenBot 빌드에는 GitHub App이 없어요.",
  "error.connector.githubDenied": "GitHub 로그인이 거부됐어요.",
  "error.connector.githubCodeExpired": "GitHub 코드가 만료됐어요. GitHub를 다시 연결해 주세요.",
  "error.connector.githubDeviceFlowDisabled": "이 GitHub App은 기기 로그인을 허용하지 않아요.",
  "error.connector.githubClientUnknown": "GitHub가 이 GitHub App의 Client ID를 알지 못해요.",
  "error.connector.githubUnexpected": "GitHub가 예상하지 못한 응답을 보냈어요: {detail}",
  "error.connector.githubUnreachable": "OpenBot이 GitHub에 연결할 수 없어요: {detail}",
  "error.connector.githubExpired": "GitHub 연결이 만료됐어요. GitHub를 다시 연결해 주세요.",
  "error.connector.githubFileUnreadable": "GitHub 연결 파일을 읽을 수 없어요.",
  "error.connector.githubFileTooLarge": "GitHub 연결 파일이 너무 커요.",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "OpenBot이 1Password CLI를 찾을 수 없어요. CLI를 설치하고 1Password 앱에서 연동을 켜거나, 서비스 계정 토큰을 사용해 주세요.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot이 1Password CLI를 설치하지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI에 로그인되어 있지 않아요. 1Password 앱에서 연동을 켠 후 다시 연결해 주세요.",
  "error.connector.onePasswordCliFailed": "1Password CLI가 실패했어요: {detail}",
  "error.connector.onePasswordUnexpected": "1Password가 예상하지 못한 응답을 보냈어요: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password가 서비스 계정 토큰을 받아들이지 않았어요.",
  "error.connector.onePasswordNoVault":
    "서비스 계정이 볼트를 읽을 수 없어요. 볼트에 대한 접근 권한을 부여한 후 다시 시도해 주세요.",
  "error.connector.onePasswordFileUnreadable": "1Password 연결 파일을 읽을 수 없어요.",
  "error.connector.onePasswordFileTooLarge": "1Password 연결 파일이 너무 커요.",
  "error.connector.bitwardenFailed":
    "Bitwarden을 읽을 수 없어요. bw CLI를 설치하고, 로그인한 후 잠금을 해제하고, Shared with OpenBot이라는 폴더를 하나 만들어 주세요. 새 세션 키로 연결해 주세요.",
  "error.connector.bitwardenHostInput":
    "HTTPS 서버 주소, API 키의 client_id와 client_secret, 마스터 비밀번호를 입력해 주세요.",
  "error.connector.bitwardenHostFailed":
    "이 서버에서 Bitwarden을 열 수 없어요. 서버 주소, API 키, 마스터 비밀번호를 확인하고 Shared with OpenBot이라는 폴더가 하나 있는지 확인해 주세요. 그런 다음 다시 연결해 주세요.",
  "error.connector.bitwardenCliInstallFailed":
    "이 서버에 Bitwarden CLI를 설치하지 못했어요. 서버의 네트워크 연결을 확인한 후 다시 연결해 주세요.",
  "error.connector.bitwardenFileUnreadable": "Bitwarden 연결 파일을 읽을 수 없어요.",
  "error.connector.telegramAccountCredentialsMissing":
    "Telegram 앱의 api_id와 api_hash를 입력해 주세요. my.telegram.org에서 받을 수 있어요.",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id는 숫자이고 api_hash는 0-9와 a-f로 된 32자예요. my.telegram.org에서 다시 복사해 주세요.",
  "error.connector.telegramAccountApiRejected":
    "Telegram이 이 api_id와 api_hash를 받아들이지 않아요. my.telegram.org에서 다시 복사해 주세요.",
  "error.connector.telegramAccountPhoneFormat": "국가 번호를 포함해 전화번호를 입력해 주세요. 예: +48 600 100 200",
  "error.connector.telegramAccountPhoneInvalid": "Telegram이 이 번호를 알지 못해요. 국가 번호를 포함해 주세요. 예: +48",
  "error.connector.telegramAccountCodeInvalid": "코드가 올바르지 않아요. 확인한 후 다시 시도해 주세요.",
  "error.connector.telegramAccountCodeEmpty": "Telegram이 보낸 코드를 입력해 주세요.",
  "error.connector.telegramAccountCodeExpired": "코드가 만료됐어요. 새 코드를 받으려면 다시 시작해 주세요.",
  "error.connector.telegramAccountPasswordInvalid": "비밀번호가 올바르지 않아요. 다시 시도해 주세요.",
  "error.connector.telegramAccountPasswordEmpty": "2단계 인증 비밀번호를 입력해 주세요.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram에 2단계 인증 비밀번호가 필요해요.",
  "error.connector.telegramAccountNoAccount":
    "이 번호에는 Telegram 계정이 없어요. 이미 Telegram을 사용하는 번호로 로그인해 주세요.",
  "error.connector.telegramAccountPhoneBanned": "Telegram이 이 번호를 차단했어요.",
  "error.connector.telegramAccountQrExpired": "스캔하기 전에 QR 코드가 만료됐어요. 다시 시작해 주세요.",
  "error.connector.telegramAccountFloodWait": "Telegram이 잠시 기다려 달라고 해요. {count}분 후에 다시 시도해 주세요.",
  "error.connector.telegramAccountCancelled": "Telegram 로그인이 취소됐어요.",
  "error.connector.telegramAccountTimedOut": "10분 동안 아무 활동이 없어 로그인을 중단했어요. 다시 시작해 주세요.",
  "error.connector.telegramAccountMovedOn": "로그인이 다른 단계로 넘어갔어요. 다시 시작해 주세요.",
  "error.connector.telegramAccountRefused": "Telegram이 로그인을 거부했어요: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot이 Telegram 연결을 저장하지 못했어요: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram이 이 세션을 종료했어요(예: 설정 > 기기). Telegram 계정을 다시 연결해 주세요.",
  "error.connector.telegramAccountFileUnreadable": "Telegram 계정 연결 파일을 읽을 수 없어요.",
  "error.connector.telegramAccountFileTooLarge": "Telegram 계정 연결 파일이 너무 커요.",
  "error.connector.whatsappAccountPhoneFormat": "국가 번호를 포함해 전화번호를 입력해 주세요. 예: +48 600 100 200",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp이 코드를 주지 않았어요: {detail}",
  "error.connector.whatsappAccountQrExpired": "사용하기 전에 코드가 만료됐어요. 다시 시작해 주세요.",
  "error.connector.whatsappAccountTimedOut": "10분 동안 아무 활동이 없어 기기 연결을 중단했어요. 다시 시작해 주세요.",
  "error.connector.whatsappAccountMovedOn": "기기 연결이 다른 단계로 넘어갔어요. 다시 시작해 주세요.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp이 이 기기를 연결하지 않았어요: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot이 WhatsApp 연결을 저장하지 못했어요: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp이 이 기기를 삭제했어요(예: 설정 > 연결된 기기). WhatsApp 계정을 다시 연결해 주세요.",
  "error.connector.whatsappAccountReplaced":
    "다른 프로그램이 이 연결된 기기를 열어서 WhatsApp이 여기의 연결을 닫았어요. 연결을 해제한 후 다시 연결해 주세요.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp이 이 기기를 거부했어요. 번호가 제한되었을 수 있어요. 휴대폰의 WhatsApp을 확인해 주세요.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp이 더 이상 이 버전의 연결을 받아들이지 않아요. OpenBot을 업데이트한 후 다시 연결해 주세요.",
  "error.connector.whatsappAccountOffline":
    "지금은 WhatsApp에 연결할 수 없어요. OpenBot이 다시 시도해요. 에이전트는 이 컴퓨터에 있는 채팅을 계속 읽을 수 있어요.",
  "error.connector.whatsappAccountFileUnreadable": "WhatsApp 계정 연결 파일을 읽을 수 없어요.",
} as const satisfies PartialTranslation<typeof source>;
