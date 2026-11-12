import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/startup";

export const messages = {
  // The one native error box: the app could not start, so no renderer exists to show it.
  "startup.failedTitle": "OpenBot 无法启动",
  "startup.failedBody": "{message}\n\n你的本地数据没有被重置或覆盖。请查看故障排查指南了解恢复步骤。",
  "startup.archiveChangedTitle": "OpenBot 文件已被更改",
  "startup.archiveChangedBody":
    "另一个程序更改了 OpenBot 的文件 app.asar。OpenBot 现在仍在运行，但退出后将无法再次打开。\n\n要修复 OpenBot，请重新安装。你的本地数据会保留。",
  "startup.archiveChangedDownload": "下载 OpenBot",
  "startup.filesDamagedBody": "部分 OpenBot 文件已损坏或缺失。\n\n要修复 OpenBot，请重新安装。你的本地数据会保留。",
  "startup.newerDataUpdatingTitle": "正在更新 OpenBot",
  "startup.newerDataUpdatingBody":
    "较新版本的 OpenBot 保存了你的数据。OpenBot 将安装最新版本，然后重新打开。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataTitle": "请安装最新版 OpenBot",
  "startup.newerDataBody":
    "较新版本的 OpenBot 保存了你的数据，此版本（{version}）无法打开这些数据。请安装最新版本以打开你的数据。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataDownload": "下载 OpenBot",
  "startup.newerDataGuide": "打开指南",
  "startup.newerDataQuit": "退出",
  "startup.recoveryWindowTitle": "OpenBot 恢复",
  "startup.recoveryTitle": "OpenBot 未能打开",
  "startup.recoveryBody": {
    other: "OpenBot {version} 在打开前已连续 {count} 次停止。你的本地数据没有被重置或覆盖。",
  },
  "startup.recoveryHint": "请重试，或安装上一个能打开的版本。如需帮助，请导出诊断信息，并将文件随报告一起发送。",
  "startup.recoveryRetry": "重试",
  "startup.recoveryPreviousVersion": "下载上一个版本",
  "startup.recoveryExportDiagnostics": "导出诊断信息",
  "startup.recoveryOpenDataFolder": "打开数据文件夹",
  "startup.recoveryQuit": "退出",
  "startup.recoveryDiagnosticsSaved": "诊断文件已保存。",
  "startup.recoveryActionFailed": "OpenBot 无法执行此操作。",
} as const satisfies PartialTranslation<typeof source>;
