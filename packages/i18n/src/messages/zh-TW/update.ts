import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/update";

export const messages = {
  // The app update button in Settings, one label for each updater phase.
  "update.action.check": "檢查更新",
  "update.action.checking": "正在檢查更新…",
  "update.action.download": "下載更新",
  "update.action.downloading": "正在下載更新…",
  "update.action.restart": "重啟以更新",
  "update.action.restarting": "正在重啟…",
  "update.action.retryDownload": "重試下載",
  "update.managedByHost": "由主機管理",
  "update.upToDate": "已是最新",

  // The provider CLI update notification.
  "update.provider.update": "更新",
  "update.provider.upToDate": "{name} 已是最新",
  "update.provider.checking": "正在檢查 {name} 更新",
  "update.provider.available": "{name} 有可用更新",
  "update.provider.updating": "正在更新 {name}",
  "update.provider.waiting": "正在等待更新 {name}",
  "update.provider.failed": "{name} 更新失敗",
  "update.provider.settingUp": "配置中",
  "update.provider.failedRetry": "更新失敗，請重試。",
  "update.provider.unknownVersion": "未知版本",
  "update.provider.remoteHost": "供應商 CLI 的更新在託管它的電腦上執行。",
  "update.provider.unavailable": "供應商更新不可用。",
  "update.provider.downloadsUnavailable": "供應商下載不可用。",
  "update.provider.startFailed": "無法開始更新，請重試。",
  "update.provider.showDetails": "顯示詳情",
  "update.provider.hideDetails": "隱藏詳情",

  // An update that an admin of this server asked for. {name} is the admin.
  "update.scheduled.title": "{name} 計劃了一次 OpenBot 更新",
  // The same notice when "Install updates automatically" scheduled the restart.
  "update.scheduled.automaticTitle": "OpenBot 正在安裝更新",
  "update.scheduled.whenIdle": "助理空閒時 OpenBot 會重啟。",
  "update.scheduled.now": "更新下載完成後 OpenBot 會重啟。",
  "update.scheduled.cancel": "取消更新",
  "update.scheduled.cancelFailed": "無法取消該更新。",

  // A restart that the user of this computer asked for. It waits until no work runs.
  "update.idleRestart.relaunchTitle": "助理空閒時 OpenBot 會重啟",
  "update.idleRestart.updateTitle": "助理空閒時 OpenBot 會安裝更新",
  "update.idleRestart.description": "新的自動化任務執行會等到重啟之後。",
  "update.idleRestart.waitingFor": "正在等待{reasons}。",
  "update.idleRestart.cancel": "取消重啟",
  "update.idleRestart.cancelFailed": "無法取消該重啟。",
  "update.idleRestart.requestFailed": "無法安排該重啟。",
  "update.idleRestart.failedTitle": "OpenBot 未重啟",

  // The "What's new" dialog after an app update.
  "update.whatsNew.title": "OpenBot 的新功能",
  "update.whatsNew.description": "該版本的新功能和改動。",
  "update.whatsNew.version": "版本 {version}",
  "update.whatsNew.updatedFrom": "已從 {from} 更新到 {to}",
  "update.whatsNew.group.added": "新增",
  "update.whatsNew.group.changed": "改進",
  "update.whatsNew.group.fixed": "修復",
  "update.whatsNew.notices": "更新後請完成這些操作",
  "update.whatsNew.showFixes": { one: "顯示 {count} 項修復", other: "顯示 {count} 項修復" },
  "update.whatsNew.hideFixes": "隱藏修復項",
  "update.whatsNew.loading": "正在載入更新日誌…",
  "update.whatsNew.failed.title": "更新日誌載入失敗",
  "update.whatsNew.failed.body": "請確認網路已連線後重試。完整更新日誌也會列出所有改動。",
  "update.whatsNew.empty.title": "該版本沒有新功能",
  "update.whatsNew.empty.body": "該版本沒有可在此展示的更新說明。完整更新日誌會列出所有改動。",
  "update.whatsNew.changelog": "完整更新日誌",
  "update.whatsNew.changelogFailed": "OpenBot 無法開啟更新日誌。",
  "update.whatsNew.done": "知道了",
} as const satisfies PartialTranslation<typeof source>;
