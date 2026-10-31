import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal 尚未提供 ICE 伺服器。",
  "error.host.keyRotationUnavailable": "沒有帳號服務，該伺服器無法更改金鑰。",
  "error.host.keyRotationRefused": "帳號服務沒有接受新的伺服器金鑰，仍繼續使用當前金鑰。",
  "error.host.webRtcNotConfigured": "WebRTC 主機服務未配置。",
  "error.host.runtimeNotInstalled": "遠端桌面執行時未安裝。",
  "error.host.setupUnavailable": "權限設定不可用。",
  "error.host.accountChangedDuringUpdate": "更新該伺服器期間，已登入的帳號發生了變更。",
  "error.host.nameBeforePublish": "釋出前請先為該 OpenBot 命名。",
  "error.host.memberNotFound": "該遠端成員不存在。",
  "error.host.publishBeforeInvite": "建立邀請前請先將該 OpenBot 設為公開。",
  "error.host.teamAccessUnavailable": "你的團隊訪問權限不可用。",
  "error.host.ownerIdentityUnavailable": "主機所有者身分不可用。",
  "error.host.reserveAddressFailed": "無法預留公網地址。",
  "error.host.publishFailed": "無法釋出該 OpenBot。",
  "error.host.mobileConnectPublishFailed": "無法為該 OpenBot 啟用手機連線釋出。",
  "error.host.mobileConnectHostChanged": "手機連線的主機已更改，請重試。",
  "error.host.noServer": "這臺電腦沒有可更改的伺服器。",
  "error.host.identityLocalOnly": "伺服器名稱和標誌只能在執行它的電腦上更改。",
  "error.host.timezoneInvalid": "未知的時區。",
  "error.host.maintenanceInterrupted": "主機維護被中斷。請校驗應用並重置主機狀態後再重試。",
  "error.host.updateFailed": "主機更新在「{phase}」階段失敗。重置狀態前請校驗包歸屬、簽名、租戶狀態和可用磁碟空間。",
  "error.host.tenantsNotIdle": "兩小時內租戶未能保持空閒五分鐘。",
  "error.host.tenantShutdownTimeout": "租戶關閉超時，未開始替換應用。",
  "error.host.tenantHealthMissing": "重啟後租戶健康報告缺失或不健康。再次更新前請檢查租戶工作階段。",
} as const satisfies PartialTranslation<typeof source>;
