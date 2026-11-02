import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  // Errors from app, notification, and secret storage actions.
  "error.app.externalLinkProtocol": "只有 HTTP(S) 連結可以在外部瀏覽器中開啟。",
  "error.app.notificationsUnsupported": "該系統不支援桌面通知。",
  "error.app.notificationSettingsMissing": "該系統沒有通知設定頁面。",
  "error.app.notReady": "OpenBot 尚未就緒。",
  "error.app.macSecureStorageUnavailable": "macOS 安全儲存不可用。",
  "error.app.secretStorageUnavailable": "系統金鑰儲存不可用。",
  "error.app.remoteIdentityUnavailable": "遠端主機身分不可用。",
  "error.app.iceServersMissing": "Remote Signal 尚未提供 ICE 伺服器。",
  "error.app.finishLocalTest": "請先完成本地測試再切換顯示器。",
} as const satisfies PartialTranslation<typeof source>;
