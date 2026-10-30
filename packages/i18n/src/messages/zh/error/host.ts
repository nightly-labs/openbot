import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  // Errors from host setup, publishing, and host maintenance.
  "error.host.iceServersMissing": "Remote Signal 尚未提供 ICE 服务器。",
  "error.host.keyRotationUnavailable": "没有账号服务，该服务器无法更改密钥。",
  "error.host.keyRotationRefused": "账号服务没有接受新的服务器密钥，仍继续使用当前密钥。",
  "error.host.webRtcNotConfigured": "WebRTC 主机服务未配置。",
  "error.host.runtimeNotInstalled": "远程桌面运行时未安装。",
  "error.host.setupUnavailable": "权限设置不可用。",
  "error.host.accountChangedDuringUpdate": "更新该服务器期间，已登录的账号发生了变更。",
  "error.host.nameBeforePublish": "发布前请先为该 OpenBot 命名。",
  "error.host.memberNotFound": "该远程成员不存在。",
  "error.host.publishBeforeInvite": "创建邀请前请先将该 OpenBot 设为公开。",
  "error.host.teamAccessUnavailable": "你的团队访问权限不可用。",
  "error.host.ownerIdentityUnavailable": "主机所有者身份不可用。",
  "error.host.reserveAddressFailed": "无法预留公网地址。",
  "error.host.publishFailed": "无法发布该 OpenBot。",
  "error.host.mobileConnectPublishFailed": "无法为该 OpenBot 启用手机连接发布。",
  "error.host.mobileConnectHostChanged": "手机连接的主机已更改，请重试。",
  "error.host.noServer": "这台电脑没有可更改的服务器。",
  "error.host.identityLocalOnly": "服务器名称和标志只能在运行它的电脑上更改。",
  "error.host.timezoneInvalid": "未知的时区。",
  "error.host.maintenanceInterrupted": "主机维护被中断。请校验应用并重置主机状态后再重试。",
  "error.host.updateFailed": "主机更新在“{phase}”阶段失败。重置状态前请校验包归属、签名、租户状态和可用磁盘空间。",
  "error.host.tenantsNotIdle": "两小时内租户未能保持空闲五分钟。",
  "error.host.tenantShutdownTimeout": "租户关闭超时，未开始替换应用。",
  "error.host.tenantHealthMissing": "重启后租户健康报告缺失或不健康。再次更新前请检查租户会话。",
} as const satisfies PartialTranslation<typeof source>;
