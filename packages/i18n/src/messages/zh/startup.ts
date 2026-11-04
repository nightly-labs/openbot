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
  "startup.newerDataUpdatingTitle": "正在更新 OpenBot",
  "startup.newerDataUpdatingBody":
    "较新版本的 OpenBot 保存了你的数据。OpenBot 将安装最新版本，然后重新打开。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataTitle": "请安装最新版 OpenBot",
  "startup.newerDataBody":
    "较新版本的 OpenBot 保存了你的数据，此版本（{version}）无法打开这些数据。请安装最新版本以打开你的数据。\n\n你的本地数据未被重置或覆盖。",
  "startup.newerDataDownload": "下载 OpenBot",
  "startup.newerDataGuide": "打开指南",
  "startup.newerDataQuit": "退出",
} as const satisfies PartialTranslation<typeof source>;
