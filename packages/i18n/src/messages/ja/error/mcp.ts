import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "このアドレスには名前でアクセスできません。",
  "error.mcp.redirectGetOnly": "このアドレスは GET のみに応答します。",
  "error.mcp.redirectNotSignIn": "このアドレスはサインインの一部ではありません。",
  "error.mcp.redirectRefused": "サインインが拒否されました。OpenBot に戻って、もう一度お試しください。",
  "error.mcp.redirectNoSignIn": "これを待っているサインインはありません。すでに終了した可能性があります。",
  "error.mcp.redirectSignedIn": "OpenBot にサインインしました。このウィンドウは閉じてもかまいません。",
  "error.mcp.signInFileUnreadable": "MCP のサインインファイルを読み取れません。",
  "error.mcp.signInFileTooLarge": "MCP のサインインファイルが大きすぎます。",
  "error.mcp.unsupported": "このサーバーは MCP サーバーに対応していません。",
} as const satisfies PartialTranslation<typeof source>;
