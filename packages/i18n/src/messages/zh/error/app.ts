import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/app";

export const messages = {
  "error.app.externalLinkProtocol": "只有 HTTP(S) 链接可以在外部浏览器中打开。",
  "error.app.notificationsUnsupported": "该系统不支持桌面通知。",
  "error.app.notificationSettingsMissing": "该系统没有通知设置页面。",
  "error.app.notReady": "OpenBot 尚未就绪。",
  "error.app.macSecureStorageUnavailable": "macOS 安全存储不可用。",
  "error.app.secretStorageUnavailable": "系统密钥存储不可用。",
  "error.app.remoteIdentityUnavailable": "远程主机身份不可用。",
  "error.app.iceServersMissing": "Remote Signal 尚未提供 ICE 服务器。",
  "error.app.finishLocalTest": "请先完成本地测试再切换显示器。",
  "error.app.windowBlockedBySecuritySoftware":
    "这台电脑上的安全软件可能停止了 OpenBot 窗口。请在安全软件（例如 Kaspersky）中将 OpenBot.exe 添加为受信任的应用程序，然后重新启动 OpenBot。",
} as const satisfies PartialTranslation<typeof source>;
