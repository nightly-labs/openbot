import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "無法透過名稱訪問該地址。",
  "error.mcp.redirectGetOnly": "該地址只回應 GET 請求。",
  "error.mcp.redirectNotSignIn": "該地址不屬於任何登入流程。",
  "error.mcp.redirectRefused": "登入被拒絕，請返回 OpenBot 重試。",
  "error.mcp.redirectNoSignIn": "沒有等待處理的登入，它可能已結束。",
  "error.mcp.redirectSignedIn": "OpenBot 已登入，你可以關閉該視窗。",
  "error.mcp.signInFileUnreadable": "MCP 登入檔案無法讀取。",
  "error.mcp.signInFileTooLarge": "MCP 登入檔案過大。",
  "error.mcp.unsupported": "該伺服器不支援 MCP 伺服器。",
  "error.mcp.signInOnHost": "MCP 伺服器登入只能在主機電腦上的 OpenBot 中完成。",
  "error.mcp.signInAppUnsupported": "該伺服器不支援登入應用，請更新主機上的 OpenBot。",
  "error.mcp.redirectRelayed": "OpenBot 已將登入結果傳送到伺服器，你可以關閉該視窗。",
  "error.mcp.relayEnded": "本次登入已結束，請重新開始。",
  "error.mcp.relayNoState": "該伺服器的登入頁面未保護其返回地址，因此 OpenBot 不會在這臺電腦上開啟它。",
  "error.mcp.relayAddressInvalid": "這不是本次登入流程末尾的地址，請從瀏覽器複製完整地址。",
} as const satisfies PartialTranslation<typeof source>;
