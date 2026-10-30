import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/update";

export const messages = {
  // The app update button in Settings, one label for each updater phase.
  "update.action.check": "检查更新",
  "update.action.checking": "正在检查更新…",
  "update.action.download": "下载更新",
  "update.action.downloading": "正在下载更新…",
  "update.action.restart": "重启以更新",
  "update.action.restarting": "正在重启…",
  "update.action.retryDownload": "重试下载",
  "update.managedByHost": "由主机管理",
  "update.upToDate": "已是最新",

  // The provider CLI update notification.
  "update.provider.update": "更新",
  "update.provider.upToDate": "{name} 已是最新",
  "update.provider.checking": "正在检查 {name} 更新",
  "update.provider.available": "{name} 有可用更新",
  "update.provider.updating": "正在更新 {name}",
  "update.provider.waiting": "正在等待更新 {name}",
  "update.provider.failed": "{name} 更新失败",
  "update.provider.settingUp": "配置中",
  "update.provider.failedRetry": "更新失败，请重试。",
  "update.provider.unknownVersion": "未知版本",
  "update.provider.remoteHost": "服务商 CLI 的更新在托管它的电脑上运行。",
  "update.provider.unavailable": "服务商更新不可用。",
  "update.provider.downloadsUnavailable": "服务商下载不可用。",
  "update.provider.startFailed": "无法开始更新，请重试。",
  "update.provider.showDetails": "显示详情",
  "update.provider.hideDetails": "隐藏详情",

  // An update that an admin of this server asked for. {name} is the admin.
  "update.scheduled.title": "{name} 计划了一次 OpenBot 更新",
  // The same notice when "Install updates automatically" scheduled the restart.
  "update.scheduled.automaticTitle": "OpenBot 正在安装更新",
  "update.scheduled.whenIdle": "助手空闲时 OpenBot 会重启。",
  "update.scheduled.now": "更新下载完成后 OpenBot 会重启。",
  "update.scheduled.cancel": "取消更新",
  "update.scheduled.cancelFailed": "无法取消该更新。",

  // A restart that the user of this computer asked for. It waits until no work runs.
  "update.idleRestart.relaunchTitle": "助手空闲时 OpenBot 会重启",
  "update.idleRestart.updateTitle": "助手空闲时 OpenBot 会安装更新",
  "update.idleRestart.description": "新的自动化任务运行会等到重启之后。",
  "update.idleRestart.waitingFor": "正在等待{reasons}。",
  "update.idleRestart.cancel": "取消重启",
  "update.idleRestart.cancelFailed": "无法取消该重启。",
  "update.idleRestart.requestFailed": "无法安排该重启。",
  "update.idleRestart.failedTitle": "OpenBot 未重启",

  // The "What's new" dialog after an app update.
  "update.whatsNew.title": "OpenBot 的新功能",
  "update.whatsNew.description": "该版本的新功能和改动。",
  "update.whatsNew.version": "版本 {version}",
  "update.whatsNew.updatedFrom": "已从 {from} 更新到 {to}",
  "update.whatsNew.group.added": "新增",
  "update.whatsNew.group.changed": "改进",
  "update.whatsNew.group.fixed": "修复",
  "update.whatsNew.notices": "更新后请完成这些操作",
  "update.whatsNew.showFixes": { one: "显示 {count} 项修复", other: "显示 {count} 项修复" },
  "update.whatsNew.hideFixes": "隐藏修复项",
  "update.whatsNew.loading": "正在加载更新日志…",
  "update.whatsNew.failed.title": "更新日志加载失败",
  "update.whatsNew.failed.body": "请确认网络已连接后重试。完整更新日志也会列出所有改动。",
  "update.whatsNew.empty.title": "该版本没有新功能",
  "update.whatsNew.empty.body": "该版本没有可在此展示的更新说明。完整更新日志会列出所有改动。",
  "update.whatsNew.changelog": "完整更新日志",
  "update.whatsNew.changelogFailed": "OpenBot 无法打开更新日志。",
  "update.whatsNew.done": "知道了",
} as const satisfies PartialTranslation<typeof source>;
