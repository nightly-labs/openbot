import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable": "OpenBot 无法连接账号服务。请确认 API 正在运行后重试。",
  "error.auth.networkBlocked":
    "该网络中的防火墙或代理阻止了 OpenBot 访问 {host}。请让网络管理员放行 {host}，然后重试。",
  "error.auth.signInFirst": "请先登录 OpenBot。",
  "error.auth.signInRequired": "需要先登录。",
  "error.auth.chatColorUnavailable": "账户服务暂不支持聊天颜色。请稍后重试。",
  "error.auth.accountChangedDuringRegister": "注册该服务器期间，已登录的账号发生了变更。",
  "error.auth.hostCredentialUnavailable": "远程主机凭据不可用，请重新注册该主机。",
  "error.auth.codeNotVerified": "无法验证登录验证码。",
  "error.auth.serviceError": "账号服务返回了错误。",
  "error.auth.serviceUnreachable": "OpenBot 无法连接账号服务。请检查网络连接后重试。",
  "error.auth.serviceTimeout": "账号服务未及时响应，请重试。",
  "error.auth.serviceStatus": "账号服务返回了错误（{status}），请稍后重试。",
  "error.auth.invalidHostedServer": "账号服务返回了无效的托管服务器。",
  "error.auth.invalidServerClaim": "账号服务返回了无效的服务器代码。",
  "error.auth.codeNotSent": "OpenBot 无法发送登录验证码。",
  "error.auth.deliveryTimeout": "OpenBot 未能及时确认送达。验证码可能仍会到达，重发前请先检查送达情况。",
  "error.auth.deliveryInterrupted": "连接在 OpenBot 确认送达之前就结束了。为避免重复发送，请先检查送达情况。",
  "error.auth.deliveryUnknown": "OpenBot 无法确认登录验证码是否已发送。重发前请先检查送达情况。",
  "error.auth.companySignInFailed": "公司登录未完成，请重试。",
  "error.auth.companySignInCancelled": "公司登录已取消。",
  "error.auth.companySignInTimeout": "公司登录用时过长，请重新打开登录页面。",
  "error.auth.companySignInRefused": "公司端取消或拒绝了该登录。",
  "error.auth.companySignInDomainMismatch": "公司账号的邮箱域名不在当前配置中。",
  "error.auth.companySignInAccountDisabled": "你的公司停用了该账号，请联系管理员。",
  "error.auth.companySignInOff": "该邮箱未开启公司登录。",
  "error.auth.companySignInEmailMissing": "你的公司账号未提供已验证的邮箱地址。",
  "error.auth.companySignInUnavailable": "该 OpenBot 无法打开浏览器进行公司登录。",
  "error.auth.companySignInProviderRejected": "服务商未接受该客户端 ID 或客户端密钥。",
  "error.auth.companySignInTokenInvalid": "服务商返回的登录信息无法被 OpenBot 验证。",
  "error.auth.companySignInProviderUnreachable": "公司登录服务商未响应。",
  "error.auth.companySignInDomainTaken": "其中一个域名已通过另一台服务器登录。",
  "error.auth.companySignInNoServer": "请先启动该服务器，再设置公司登录。",
} as const satisfies PartialTranslation<typeof source>;
