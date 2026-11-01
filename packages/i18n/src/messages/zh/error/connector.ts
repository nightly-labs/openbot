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
  "error.connector.telegramAccountCredentialsMissing":
    "输入你的 Telegram 应用的 api_id 和 api_hash。你可以在 my.telegram.org 获取它们。",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id 是一个数字，api_hash 由 0-9 和 a-f 组成，共 32 个字符。请从 my.telegram.org 重新复制。",
  "error.connector.telegramAccountApiRejected": "Telegram 不接受此 api_id 和 api_hash。请从 my.telegram.org 重新复制。",
  "error.connector.telegramAccountPhoneFormat": "输入带国家/地区代码的电话号码，例如 +48 600 100 200。",
  "error.connector.telegramAccountPhoneInvalid": "Telegram 无法识别此号码。请加上国家/地区代码，例如 +48。",
  "error.connector.telegramAccountCodeInvalid": "此验证码不正确。请检查后重试。",
  "error.connector.telegramAccountCodeEmpty": "输入 Telegram 发给你的验证码。",
  "error.connector.telegramAccountCodeExpired": "验证码已过期。请重新开始以获取新验证码。",
  "error.connector.telegramAccountPasswordInvalid": "此密码不正确。请重试。",
  "error.connector.telegramAccountPasswordEmpty": "输入你的两步验证密码。",
  "error.connector.telegramAccountPasswordNeeded": "Telegram 需要你的两步验证密码。",
  "error.connector.telegramAccountNoAccount": "此号码没有 Telegram 账号。请使用已在使用 Telegram 的号码登录。",
  "error.connector.telegramAccountPhoneBanned": "Telegram 已封禁此号码。",
  "error.connector.telegramAccountQrExpired": "二维码在你扫描前已过期。请重新开始。",
  "error.connector.telegramAccountFloodWait": "Telegram 要求你稍候。请在 {count} 分钟后重试。",
  "error.connector.telegramAccountCancelled": "Telegram 登录已取消。",
  "error.connector.telegramAccountTimedOut": "登录在 10 分钟无操作后已停止。请重新开始。",
  "error.connector.telegramAccountMovedOn": "登录已进入其他步骤。请重新开始。",
  "error.connector.telegramAccountRefused": "Telegram 拒绝了登录：{detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot 无法保存 Telegram 连接：{detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram 已结束此会话，例如在“设置 > 设备”中。请重新连接你的 Telegram 账号。",
  "error.connector.telegramAccountFileUnreadable": "无法读取 Telegram 账号连接文件。",
  "error.connector.telegramAccountFileTooLarge": "Telegram 账号连接文件过大。",
  "error.connector.whatsappAccountPhoneFormat": "输入带国家/地区代码的电话号码，例如 +48 600 100 200。",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp 未提供代码：{detail}",
  "error.connector.whatsappAccountQrExpired": "代码在你使用前已过期。请重新开始。",
  "error.connector.whatsappAccountTimedOut": "关联在 10 分钟无操作后已停止。请重新开始。",
  "error.connector.whatsappAccountMovedOn": "关联已进入其他步骤。请重新开始。",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp 未关联此设备：{detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot 无法保存 WhatsApp 连接：{detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp 已移除此设备，例如在“设置 > 已关联的设备”中。请重新关联你的 WhatsApp 账号。",
  "error.connector.whatsappAccountReplaced":
    "另一个程序打开了此关联设备，因此 WhatsApp 关闭了这里的连接。请取消关联，然后重新关联。",
  "error.connector.whatsappAccountForbidden": "WhatsApp 拒绝了此设备。你的号码可能受到限制。请在手机上检查 WhatsApp。",
  "error.connector.whatsappAccountOutdated": "WhatsApp 不再接受此版本的连接。请更新 OpenBot，然后重新关联。",
  "error.connector.whatsappAccountOffline": "目前无法连接 WhatsApp。OpenBot 会重试。智能体仍可读取这台电脑上的聊天。",
  "error.connector.whatsappAccountFileUnreadable": "无法读取 WhatsApp 账号连接文件。",
} as const satisfies PartialTranslation<typeof source>;
