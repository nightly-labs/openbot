import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  // Updater state the user reads.
  "error.update.unsupported": "仅已安装的桌面版本支持更新。",
  "error.update.notReady": "更新尚未准备好安装。",
  "error.update.restartFailed": "OpenBot 无法重启以安装更新。",
  "error.update.downloadStalled": "更新下载停止响应，请重试。",
  "error.update.installFailed": "无法安装更新。请退出并重新打开 OpenBot 后重试。",
  "error.update.downloadFailed": "无法下载更新，请重试。",
  "error.update.checkFailed": "无法检查更新，请重试。",
  "error.update.checkStalled": "更新检查停止响应，请重试。",
  "error.update.checkOffline": "无法连接更新服务，请检查网络后重试。",
  "error.update.checkUnavailable": "更新服务没有响应，OpenBot 会在几分钟后自动重试。",
  "error.update.checkNoRelease": "未找到适用于该平台的已发布更新，OpenBot 会在几分钟后自动重试。",
  "error.update.managedByNix": "该 OpenBot 副本的更新由 Nix 安装。请用 Nix 更新。",
  "error.update.managedByHost": "这台 Mac 的更新由主机安装。更新会保持就绪，等主机维护运行时安装。",
  "error.update.siblingSession":
    "该应用还有另一个 OpenBot 会话在运行。请先在其他所有 macOS 用户账号中停止 OpenBot，然后重新安装更新。",
  "error.update.siblingSessionSameAccount": "该用户账号下还有另一个 OpenBot 进程在运行，请退出后重新安装更新。",
  "error.update.siblingCheckFailed": "无法确认其他 OpenBot 会话，请在安装前重试。",
  // A joined server's admin reads these from the host.
  "error.update.remoteDisabled": "这台电脑已关闭“允许服务器成员触发更新”。",
  "error.update.restartStarted": "OpenBot 已在重启以安装更新。",
  "error.update.alreadyRestarting": "OpenBot 已在重启。",
} as const satisfies PartialTranslation<typeof source>;
