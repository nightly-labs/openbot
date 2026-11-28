import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "仅已安装的桌面版本支持更新。",
  "error.update.notReady": "更新尚未准备好安装。",
  "error.update.restartFailed": "OpenBot 无法重启以安装更新。",
  "error.update.downloadStalled": "更新下载停止响应，请重试。",
  "error.update.installFailed": "无法安装更新。请退出并重新打开 OpenBot 后重试。",
  "error.update.notInstalled": "上次重启未能安装更新。请重启以重试。",
  "error.update.needsAdministrator":
    "OpenBot 无法自行安装更新，因为 macOS 需要管理员密码才能替换 OpenBot。请在这台电脑上点击“重启”，然后输入密码。",
  "error.update.downloadFailed": "无法下载更新，请重试。",
  "error.update.signatureNotConfirmed":
    "OpenBot 无法验证此更新，请重试。如果仍然出错，请从 openbot.run/download 下载 OpenBot。",
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
  "error.update.readOnlyLocation":
    "OpenBot 无法从此位置安装更新。请退出 OpenBot。在“访达”中，将 OpenBot 拖到“应用程序”文件夹（如果它已经在那里，请先拖出来再拖回去）。然后打开 OpenBot，再次安装更新。",
  "error.update.appImageMissing":
    "OpenBot 无法安装更新，因为它的 AppImage 文件已被移动、重命名或替换。请退出 OpenBot，然后重新打开该 AppImage 文件。",
  "error.update.appImageReadOnly":
    "OpenBot 无法在其 AppImage 文件所在的文件夹中安装更新。请退出 OpenBot，将 AppImage 文件移到主文件夹中的某个文件夹，然后打开它并重新安装更新。",
  "error.update.remoteDisabled": "这台电脑已关闭“允许服务器成员触发更新”。",
  "error.update.restartStarted": "OpenBot 已在重启以安装更新。",
  "error.update.alreadyRestarting": "OpenBot 已在重启。",
} as const satisfies PartialTranslation<typeof source>;
