import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  // Status lines of remote desktop setup and remote connection recovery.
  "status.remote.setupMacOnly": "权限设置仅在 macOS 上可用。",
  "status.remote.setupInstallHost": "请先安装远程桌面主机组件，然后重新检查。",
  "status.remote.setupUpdateRuntime": "请更新远程桌面运行时以检查 macOS 权限。",
  "status.remote.setupCheckFailed": "Sunshine 未能完成权限检查，请检查主机会话后重试。",
  "status.remote.setupServiceFailed": "远程桌面服务无法启动，请确认该 macOS 用户有活跃的图形会话。",
  "status.remote.connectingSunshine": "正在通过 Sunshine 连接…",
  "status.remote.switchingMonitor": "正在切换共享显示器…",
  "status.remote.controlConnected": "远程控制已连接。",
  "status.remote.controlFailed": "远程控制失败。",
  "status.remote.stagePreferences": "正在加载本地聊天偏好：{reason}",
  "status.remote.stageConnection": "正在连接桌面：{reason}",
  "status.remote.stageCompatibility": "正在检查桌面兼容性：{reason}",
  "status.remote.stageAgents": "正在加载助手：{reason}",
  "status.remote.stageReads": "正在加载已读状态：{reason}",
  "status.remote.suspendedDetail": "连接前请先更新 OpenBot 手机版或桌面应用。\n{detail}",
  "status.remote.cooldownDetail": "连续 {limit} 次连接失败，将在 {minutes}:{seconds} 后重试。\n{detail}",
  "status.remote.cooldown": "连续 {limit} 次连接失败，将在 {minutes}:{seconds} 后重试。",
  "status.remote.connectionLostDetail": {
    one: "连接已断开，将在 {count} 秒后重试。\n{detail}",
    other: "连接已断开，将在 {count} 秒后重试。\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "连接已断开，将在 {count} 秒后重试。",
    other: "连接已断开，将在 {count} 秒后重试。",
  },
  "status.remote.attemptFailedDetail": {
    one: "连接尝试失败，将在 {count} 秒后重试。\n{detail}",
    other: "连接尝试失败，将在 {count} 秒后重试。\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "连接尝试失败，将在 {count} 秒后重试。",
    other: "连接尝试失败，将在 {count} 秒后重试。",
  },
  "status.remote.reconnectingDetail": {
    one: "正在重连 {attempt}/{count}\n{detail}",
    other: "正在重连 {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "正在重连 {attempt}/{count}", other: "正在重连 {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
