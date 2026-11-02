import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Updater state the user reads.
  "error.update.unsupported": "僅已安裝的桌面版本支援更新。",
  "error.update.notReady": "更新尚未準備好安裝。",
  "error.update.restartFailed": "OpenBot 無法重啟以安裝更新。",
  "error.update.downloadStalled": "更新下載停止回應，請重試。",
  "error.update.installFailed": "無法安裝更新。請退出並重新開啟 OpenBot 後重試。",
  "error.update.downloadFailed": "無法下載更新，請重試。",
  "error.update.checkFailed": "無法檢查更新，請重試。",
  "error.update.checkStalled": "更新檢查停止回應，請重試。",
  "error.update.checkOffline": "無法連線更新服務，請檢查網路後重試。",
  "error.update.checkUnavailable": "更新服務沒有回應，OpenBot 會在幾分鐘後自動重試。",
  "error.update.checkNoRelease": "未找到適用於該平臺的已釋出更新，OpenBot 會在幾分鐘後自動重試。",
  "error.update.managedByNix": "該 OpenBot 副本的更新由 Nix 安裝。請用 Nix 更新。",
  "error.update.managedByHost": "這臺 Mac 的更新由主機安裝。更新會保持就緒，等主機維護執行時安裝。",
  "error.update.siblingSession":
    "該應用還有另一個 OpenBot 工作階段在執行。請先在其他所有 macOS 使用者帳號中停止 OpenBot，然後重新安裝更新。",
  "error.update.siblingSessionSameAccount": "該使用者帳號下還有另一個 OpenBot 程序在執行，請退出後重新安裝更新。",
  "error.update.siblingCheckFailed": "無法確認其他 OpenBot 工作階段，請在安裝前重試。",
  // A joined server's admin reads these from the host.
  "error.update.remoteDisabled": "這臺電腦已關閉「允許伺服器成員觸發更新」。",
  "error.update.restartStarted": "OpenBot 已在重啟以安裝更新。",
  "error.update.alreadyRestarting": "OpenBot 已在重啟。",
} as const satisfies PartialTranslation<typeof source>;
