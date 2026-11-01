import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "該版本的 OpenBot 不包含 GitHub App。",
  "error.connector.githubDenied": "GitHub 登入被拒絕。",
  "error.connector.githubCodeExpired": "GitHub 驗證碼已過期，請重新連線 GitHub。",
  "error.connector.githubDeviceFlowDisabled": "該 GitHub App 不允許使用裝置碼登入。",
  "error.connector.githubClientUnknown": "GitHub 不認識該 GitHub App 的客戶端 ID。",
  "error.connector.githubUnexpected": "GitHub 返回了意外的回應：{detail}",
  "error.connector.githubUnreachable": "OpenBot 無法連線 GitHub：{detail}",
  "error.connector.githubExpired": "GitHub 連線已過期，請重新連線 GitHub。",
  "error.connector.githubFileUnreadable": "GitHub 連線檔案無法讀取。",
  "error.connector.githubFileTooLarge": "GitHub 連線檔案過大。",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "OpenBot 找不到 1Password CLI。請安裝它並在 1Password 應用中開啟整合，或改用服務帳號權杖。",
  "error.connector.onePasswordCliInstallFailed": "OpenBot 無法安裝 1Password CLI，請檢查網路連線後重試。",
  "error.connector.onePasswordCliSignedOut": "1Password CLI 未登入。請在 1Password 應用中開啟整合後重新連線。",
  "error.connector.onePasswordCliFailed": "1Password CLI 執行失敗：{detail}",
  "error.connector.onePasswordUnexpected": "1Password 返回了意外的回應：{detail}",
  "error.connector.onePasswordTokenRejected": "1Password 未接受該服務帳號權杖。",
  "error.connector.onePasswordNoVault": "該服務帳號無法讀取任何保險庫。請授予其保險庫訪問權限後重試。",
  "error.connector.onePasswordFileUnreadable": "1Password 連線檔案無法讀取。",
  "error.connector.onePasswordFileTooLarge": "1Password 連線檔案過大。",
  "error.connector.bitwardenFailed":
    "無法讀取 Bitwarden。請安裝 bw CLI、登入並解鎖，然後建立一個名為 Shared with OpenBot 的資料夾，用新的工作階段金鑰連線。",
  "error.connector.bitwardenHostInput": "請填寫 HTTPS 伺服器地址、API 金鑰的 client_id 和 client_secret，以及主密碼。",
  "error.connector.bitwardenHostFailed":
    "無法在該伺服器上開啟 Bitwarden。請檢查伺服器地址、API 金鑰和主密碼，並確認有一個資料夾名為 Shared with OpenBot，然後重新連線。",
  "error.connector.bitwardenCliInstallFailed": "無法在該伺服器上安裝 Bitwarden CLI。請檢查它的網路連線，然後重新連線。",
  "error.connector.bitwardenFileUnreadable": "Bitwarden 連線檔案無法讀取。",
} as const satisfies PartialTranslation<typeof source>;
