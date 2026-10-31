import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "權限設定僅在 macOS 上可用。",
  "status.remote.setupInstallHost": "請先安裝遠端桌面主機元件，然後重新檢查。",
  "status.remote.setupUpdateRuntime": "請更新遠端桌面執行時以檢查 macOS 權限。",
  "status.remote.setupCheckFailed": "Sunshine 未能完成權限檢查，請檢查主機工作階段後重試。",
  "status.remote.setupServiceFailed": "遠端桌面服務無法啟動，請確認該 macOS 使用者有活躍的圖形工作階段。",
  "status.remote.connectingSunshine": "正在透過 Sunshine 連線…",
  "status.remote.switchingMonitor": "正在切換共享顯示器…",
  "status.remote.controlConnected": "遠端控制已連線。",
  "status.remote.controlFailed": "遠端控制失敗。",
  "status.remote.stagePreferences": "正在載入本地聊天偏好：{reason}",
  "status.remote.stageConnection": "正在連線桌面：{reason}",
  "status.remote.stageCompatibility": "正在檢查桌面相容性：{reason}",
  "status.remote.stageAgents": "正在載入助理：{reason}",
  "status.remote.stageReads": "正在載入已讀狀態：{reason}",
  "status.remote.suspendedDetail": "連線前請先更新 OpenBot 手機版或桌面應用。\n{detail}",
  "status.remote.cooldownDetail": "連續 {limit} 次連線失敗，將在 {minutes}:{seconds} 後重試。\n{detail}",
  "status.remote.cooldown": "連續 {limit} 次連線失敗，將在 {minutes}:{seconds} 後重試。",
  "status.remote.connectionLostDetail": {
    one: "連線已斷開，將在 {count} 秒後重試。\n{detail}",
    other: "連線已斷開，將在 {count} 秒後重試。\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "連線已斷開，將在 {count} 秒後重試。",
    other: "連線已斷開，將在 {count} 秒後重試。",
  },
  "status.remote.attemptFailedDetail": {
    one: "連線嘗試失敗，將在 {count} 秒後重試。\n{detail}",
    other: "連線嘗試失敗，將在 {count} 秒後重試。\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "連線嘗試失敗，將在 {count} 秒後重試。",
    other: "連線嘗試失敗，將在 {count} 秒後重試。",
  },
  "status.remote.reconnectingDetail": {
    one: "正在重連 {attempt}/{count}\n{detail}",
    other: "正在重連 {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "正在重連 {attempt}/{count}", other: "正在重連 {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
