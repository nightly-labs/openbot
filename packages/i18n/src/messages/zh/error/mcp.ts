import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "无法通过名称访问该地址。",
  "error.mcp.redirectGetOnly": "该地址只响应 GET 请求。",
  "error.mcp.redirectNotSignIn": "该地址不属于任何登录流程。",
  "error.mcp.redirectRefused": "登录被拒绝，请返回 OpenBot 重试。",
  "error.mcp.redirectNoSignIn": "没有等待处理的登录，它可能已结束。",
  "error.mcp.redirectSignedIn": "OpenBot 已登录，你可以关闭该窗口。",
  "error.mcp.signInFileUnreadable": "MCP 登录文件无法读取。",
  "error.mcp.signInFileTooLarge": "MCP 登录文件过大。",
  "error.mcp.unsupported": "该服务器不支持 MCP 服务器。",
  "error.mcp.signInOnHost": "MCP 服务器登录只能在主机电脑上的 OpenBot 中完成。",
  "error.mcp.signInAppUnsupported": "该服务器不支持登录应用，请更新主机上的 OpenBot。",
  "error.mcp.redirectRelayed": "OpenBot 已将登录结果发送到服务器，你可以关闭该窗口。",
  "error.mcp.relayEnded": "本次登录已结束，请重新开始。",
  "error.mcp.relayNoState": "该服务器的登录页面未保护其返回地址，因此 OpenBot 不会在这台电脑上打开它。",
  "error.mcp.relayAddressInvalid": "这不是本次登录流程末尾的地址，请从浏览器复制完整地址。",
} as const satisfies PartialTranslation<typeof source>;
