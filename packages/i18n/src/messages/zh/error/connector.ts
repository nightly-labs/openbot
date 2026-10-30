import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "该版本的 OpenBot 不包含 GitHub App。",
  "error.connector.githubDenied": "GitHub 登录被拒绝。",
  "error.connector.githubCodeExpired": "GitHub 验证码已过期，请重新连接 GitHub。",
  "error.connector.githubDeviceFlowDisabled": "该 GitHub App 不允许使用设备码登录。",
  "error.connector.githubClientUnknown": "GitHub 不认识该 GitHub App 的客户端 ID。",
  "error.connector.githubUnexpected": "GitHub 返回了意外的响应：{detail}",
  "error.connector.githubUnreachable": "OpenBot 无法连接 GitHub：{detail}",
  "error.connector.githubExpired": "GitHub 连接已过期，请重新连接 GitHub。",
  "error.connector.githubFileUnreadable": "GitHub 连接文件无法读取。",
  "error.connector.githubFileTooLarge": "GitHub 连接文件过大。",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "OpenBot 找不到 1Password CLI。请安装它并在 1Password 应用中开启集成，或改用服务账号令牌。",
  "error.connector.onePasswordCliInstallFailed": "OpenBot 无法安装 1Password CLI，请检查网络连接后重试。",
  "error.connector.onePasswordCliSignedOut": "1Password CLI 未登录。请在 1Password 应用中开启集成后重新连接。",
  "error.connector.onePasswordCliFailed": "1Password CLI 执行失败：{detail}",
  "error.connector.onePasswordUnexpected": "1Password 返回了意外的响应：{detail}",
  "error.connector.onePasswordTokenRejected": "1Password 未接受该服务账号令牌。",
  "error.connector.onePasswordNoVault": "该服务账号无法读取任何保险库。请授予其保险库访问权限后重试。",
  "error.connector.onePasswordFileUnreadable": "1Password 连接文件无法读取。",
  "error.connector.onePasswordFileTooLarge": "1Password 连接文件过大。",
  "error.connector.bitwardenFailed":
    "无法读取 Bitwarden。请安装 bw CLI、登录并解锁，然后创建一个名为 Shared with OpenBot 的文件夹，用新的会话密钥连接。",
  "error.connector.bitwardenHostInput": "请填写 HTTPS 服务器地址、API 密钥的 client_id 和 client_secret，以及主密码。",
  "error.connector.bitwardenHostFailed":
    "无法在该服务器上打开 Bitwarden。请检查服务器地址、API 密钥和主密码，并确认有一个文件夹名为 Shared with OpenBot，然后重新连接。",
  "error.connector.bitwardenCliInstallFailed": "无法在该服务器上安装 Bitwarden CLI。请检查它的网络连接，然后重新连接。",
  "error.connector.bitwardenFileUnreadable": "Bitwarden 连接文件无法读取。",
} as const satisfies PartialTranslation<typeof source>;
