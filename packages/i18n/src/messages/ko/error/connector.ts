import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "이 OpenBot 빌드에는 GitHub App이 없어요.",
  "error.connector.githubDenied": "GitHub 로그인이 거부됐어요.",
  "error.connector.githubCodeExpired": "GitHub 코드가 만료됐어요. GitHub를 다시 연결해 주세요.",
  "error.connector.githubDeviceFlowDisabled": "이 GitHub App은 기기 로그인을 허용하지 않아요.",
  "error.connector.githubClientUnknown": "GitHub가 이 GitHub App의 Client ID를 알지 못해요.",
  "error.connector.githubUnexpected": "GitHub가 예상하지 못한 응답을 보냈어요: {detail}",
  "error.connector.githubUnreachable": "OpenBot이 GitHub에 연결할 수 없어요: {detail}",
  "error.connector.githubOffline":
    "OpenBot이 GitHub에 연결할 수 없어요. OpenBot을 실행하는 컴퓨터나 서버의 인터넷 연결과 DNS 설정을 확인한 후 다시 시도해 주세요.",
  "error.connector.githubExpired": "GitHub 연결이 만료됐어요. GitHub를 다시 연결해 주세요.",
  "error.connector.githubFileUnreadable": "GitHub 연결 파일을 읽을 수 없어요.",
  "error.connector.githubFileTooLarge": "GitHub 연결 파일이 너무 커요.",
  "error.connector.nearSignIn": "암호화폐 지갑을 사용하려면 OpenBot에 로그인하세요.",
  "error.connector.nearServiceUnavailable": "암호화폐 지갑 서비스를 사용할 수 없어요. 나중에 다시 시도해 주세요.",
  "error.connector.nearWalletNotFound": "이 지갑은 이 OpenBot 계정이나 서버의 지갑이 아니에요.",
  "error.connector.nearWalletLimit": "오늘 새로 만든 지갑이 너무 많아요. 내일 다시 시도해 주세요.",
  "error.connector.nearProviderBusy": "지금은 NEAR Intents가 응답하지 않아요. 몇 분 후에 다시 시도해 주세요.",
  "error.connector.nearNoWallet": "설정된 암호화폐 지갑이 없어요. 서버 설정 > Vault > 암호화폐에서 설정하세요.",
  "error.connector.nearWalletExists": "암호화폐 지갑이 이미 설정되어 있어요.",
  "error.connector.nearFrozen": "암호화폐 지갑 결제가 일시 중지되었어요. 서버 설정 > Vault > 암호화폐에서 재개하세요.",
  "error.connector.nearAgentNotAllowed":
    "이 에이전트는 암호화폐 지갑으로 결제할 수 없어요. 서버 설정 > Vault > 암호화폐에서 켜세요.",
  "error.connector.nearGrantExpired":
    "OpenBot에 암호화폐 지갑 결제 권한이 없어요. 서버 설정 > Vault > 암호화폐에서 갱신하세요.",
  "error.connector.nearUnknownAsset": "암호화폐 지갑에 {asset} 자산이 없어요.",
  "error.connector.nearAmountInvalid": "{amount}은(는) 올바른 {asset} 금액이 아니에요.",
  "error.connector.nearRecipientInvalid": "{recipient}은(는) NEAR 계정도, chain:address 형식도 아니에요.",
  "error.connector.nearRefused": "NEAR Intents Agent API가 요청을 거부했어요: {detail}",
  "error.connector.nearUnexpected": "NEAR Intents Agent API가 예상하지 못한 응답을 보냈어요: {detail}",
  "error.connector.nearUnreachable": "OpenBot이 NEAR Intents Agent API에 연결할 수 없어요: {detail}",
  "error.connector.nearFileUnreadable": "암호화폐 지갑 파일을 읽을 수 없어요.",
  "error.connector.nearFileTooLarge": "암호화폐 지갑 파일이 너무 커요.",
  "error.connector.nearSigningCanceled": "서명이 취소되었어요.",
  "error.connector.nearSigningExpired": "서명이 제시간에 도착하지 않았어요. 다시 시도해 주세요.",
  "error.connector.nearSigningInvalid": "브라우저에서 받은 서명이 올바르지 않아요.",
  "error.connector.nearSigningBusy": "브라우저에서 다른 서명이 대기 중이에요. 먼저 그 서명을 완료하거나 취소하세요.",
  "error.connector.nearPolicyCooldown": "{time}에 지갑 규칙을 다시 변경할 수 있어요.",
  "error.connector.nearPolicyPending": "정책 변경이 완료되지 않았어요. 몇 분 후에 다시 시도해 주세요.",
  "error.connector.nearDeclined": "소유자가 결제를 거절했어요.",
  "error.connector.nearUncertain":
    "OpenBot은 결제가 전송되었는지 알 수 없어요. 다시 결제하지 마세요. 소유자는 지갑 기록을 확인할 수 있어요.",
  "error.connector.nearPaymentFailed": "결제에 실패했어요: {detail}",
  "error.connector.nearPaymentUnknown": "이 결제는 더 이상 응답을 기다리지 않아요.",
  "error.connector.nearRuleFull": "결제 규칙 하나에는 수신자를 최대 {limit}개까지 지정할 수 있어요.",
  "error.connector.nearRulesFull": "지갑에는 결제 규칙을 최대 {limit}개까지 만들 수 있어요.",
  "error.connector.onePasswordCliMissing":
    "OpenBot이 1Password CLI를 찾을 수 없어요. CLI를 설치하고 1Password 앱에서 연동을 켜거나, 서비스 계정 토큰을 사용해 주세요.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot이 1Password CLI를 설치하지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요.",
  "error.connector.onePasswordCliSignedOut":
    "1Password CLI에 로그인되어 있지 않아요. 1Password 앱에서 연동을 켠 후 다시 연결해 주세요.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot이 1Password 앱에 연결할 수 없어요. 1Password를 열고 잠금을 해제하세요. 설정 > 개발자에서 “1Password CLI와 통합”이 켜져 있는지 확인한 후 다시 시도해 주세요.",
  "error.connector.onePasswordCliFailed": "1Password CLI가 실패했어요: {detail}",
  "error.connector.onePasswordCliForbidden":
    "이 1Password 계정으로는 공유 보관함이나 서비스 계정을 만들 수 없어요. 계정 소유자나 관리자에게 이 권한을 요청하거나, 서비스 계정 토큰을 받아 ‘토큰 사용’을 클릭해 주세요.",
  "error.connector.onePasswordUnexpected": "1Password가 예상하지 못한 응답을 보냈어요: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password가 서비스 계정 토큰을 받아들이지 않았어요.",
  "error.connector.onePasswordUnreachable":
    "OpenBot이 1Password에 연결하지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요.",
  "error.connector.onePasswordRateLimited": "1Password에 요청이 너무 많아요. 몇 분 기다린 후 다시 시도해 주세요.",
  "error.connector.onePasswordNoVault":
    "서비스 계정이 볼트를 읽을 수 없어요. 볼트에 대한 접근 권한을 부여한 후 다시 시도해 주세요.",
  "error.connector.onePasswordReadFailed":
    "OpenBot이 1Password의 로그인 정보를 읽을 수 없어요. 1Password 연결을 해제한 후 다시 연결해 주세요.",
  "error.connector.onePasswordFileUnreadable": "1Password 연결 파일을 읽을 수 없어요.",
  "error.connector.onePasswordFileTooLarge": "1Password 연결 파일이 너무 커요.",
  "error.connector.bitwardenFailed":
    "Bitwarden을 읽을 수 없어요. bw CLI를 설치하고, 로그인한 후 잠금을 해제하고, Shared with OpenBot이라는 폴더를 하나 만들어 주세요. 새 세션 키로 연결해 주세요.",
  "error.connector.bitwardenCliMissing":
    "OpenBot이 Bitwarden CLI를 찾을 수 없습니다. bw를 설치하고 새 터미널에서 작동하는지 확인한 다음 다시 연결하세요.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden에는 Shared with OpenBot이라는 폴더가 정확히 하나 있어야 합니다. 폴더를 만들거나 추가 폴더를 삭제한 다음 다시 연결하세요.",
  "error.connector.bitwardenHostInput":
    "HTTPS 서버 주소, API 키의 client_id와 client_secret, 마스터 비밀번호를 입력해 주세요.",
  "error.connector.bitwardenHostFailed":
    "이 서버에서 Bitwarden을 열 수 없어요. 서버 주소, API 키, 마스터 비밀번호를 확인하고 Shared with OpenBot이라는 폴더가 하나 있는지 확인해 주세요. 그런 다음 다시 연결해 주세요.",
  "error.connector.bitwardenHostSignInFailed":
    "이 서버에서 Bitwarden에 로그인할 수 없어요. 서버 주소와 API 키를 확인한 후 다시 연결해 주세요.",
  "error.connector.bitwardenHostUnlockFailed":
    "이 서버에서 Bitwarden 잠금을 해제할 수 없어요. 마스터 비밀번호를 확인한 후 다시 연결해 주세요.",
  "error.connector.bitwardenCliInstallFailed":
    "이 서버에 Bitwarden CLI를 설치하지 못했어요. 서버의 네트워크 연결을 확인한 후 다시 연결해 주세요.",
  "error.connector.bitwardenCliCannotStart":
    "이 서버에서 Bitwarden CLI가 시작되지 않았어요. 다시 연결해 주세요. 그래도 시작되지 않으면 도움말 > 문제 신고를 선택하세요.",
  "error.connector.bitwardenFileUnreadable": "Bitwarden 연결 파일을 읽을 수 없어요.",
  "error.connector.passwordManagerUnknown": "OpenBot에서 이 비밀번호 관리자를 지원하지 않습니다.",
  "error.connector.passwordManagerMethod": "이 비밀번호 관리자는 이 방법으로 연결할 수 없습니다.",
  "error.connector.passwordManagerNoSignIn": "열린 로그인 페이지가 없습니다. 다시 연결하세요.",
  "error.connector.protonPassFailed": "Proton Pass를 연결하지 못했습니다. 다시 연결하세요.",
  "error.connector.protonPassCliInstallFailed":
    "Proton Pass CLI를 설치하지 못했습니다. 네트워크 연결을 확인한 후 다시 연결하세요.",
  "error.connector.protonPassPlan":
    "사용 중인 Proton 요금제에서는 Proton Pass CLI를 사용할 수 없습니다. 요금제를 변경한 후 다시 연결하세요.",
  "error.connector.protonPassPlanMissing":
    "사용 중인 Proton 요금제에는 Proton Pass CLI가 포함되지 않습니다. Pass Plus가 포함된 Proton 요금제가 필요합니다. 요금제를 변경한 후 다시 연결하세요.",
  "error.connector.protonPassExpired": "Proton Pass 액세스가 종료되었습니다. 다시 연결하세요.",
  "error.connector.protonPassKeyInvalid": "pst_로 시작하는 Proton Pass 액세스 키를 입력하세요.",
  "error.connector.protonPassExtraPassword": "추가 비밀번호가 올바르지 않습니다. 다시 입력하세요.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass가 추가 비밀번호를 요청하지 않았습니다.",
  "error.connector.protonPassFileUnreadable": "Proton Pass 연결 파일을 읽을 수 없습니다.",
  "error.connector.protonPassSignInTimeout": "Proton 로그인이 너무 오래 걸렸습니다. 다시 연결하세요.",
  "error.connector.protonPassSetupFailed":
    "Proton Pass에서 Shared with OpenBot 보관함이나 해당 액세스 키를 만들지 못했습니다. 다시 연결하세요.",
} as const satisfies PartialTranslation<typeof source>;
