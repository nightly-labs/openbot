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
  "error.connector.passwordManagerUnknown": "OpenBot에서 이 비밀번호 관리자를 지원하지 않습니다.",
  "error.connector.passwordManagerMethod": "이 비밀번호 관리자는 이 방법으로 연결할 수 없습니다.",
  "error.connector.passwordManagerNoSignIn": "열린 로그인 페이지가 없습니다. 다시 연결하세요.",
  "error.connector.protonPassFailed": "Proton Pass를 연결하지 못했습니다. 다시 연결하세요.",
  "error.connector.protonPassCliInstallFailed":
    "Proton Pass CLI를 설치하지 못했습니다. 네트워크 연결을 확인한 후 다시 연결하세요.",
  "error.connector.protonPassPlan":
    "사용 중인 Proton 요금제에서는 Proton Pass CLI를 사용할 수 없습니다. 요금제를 변경한 후 다시 연결하세요.",
  "error.connector.protonPassExpired": "Proton Pass 액세스가 종료되었습니다. 다시 연결하세요.",
  "error.connector.protonPassKeyInvalid": "pst_로 시작하는 Proton Pass 액세스 키를 입력하세요.",
  "error.connector.protonPassExtraPassword": "추가 비밀번호가 올바르지 않습니다. 다시 입력하세요.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass가 추가 비밀번호를 요청하지 않았습니다.",
  "error.connector.protonPassFileUnreadable": "Proton Pass 연결 파일을 읽을 수 없습니다.",
  "error.connector.protonPassSignInTimeout": "Proton 로그인이 너무 오래 걸렸습니다. 다시 연결하세요.",
  "error.connector.protonPassSetupFailed":
    "Proton Pass에서 Shared with OpenBot 보관함이나 해당 액세스 키를 만들지 못했습니다. 다시 연결하세요.",
} as const satisfies PartialTranslation<typeof source>;
