import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "このアドレスには名前でアクセスできません。",
  "error.mcp.redirectNotSignIn": "このアドレスはサインインの一部ではありません。",
  "error.mcp.redirectRefused": "サインインが拒否されました。OpenBot に戻って、もう一度お試しください。",
  "error.mcp.redirectNoSignIn": "これを待っているサインインはありません。すでに終了した可能性があります。",
  "error.mcp.redirectSignedIn": "OpenBot にサインインしました。このウィンドウは閉じてもかまいません。",
  "error.mcp.signInFileUnreadable": "MCP のサインインファイルを読み取れません。",
  "error.mcp.signInFileTooLarge": "MCP のサインインファイルが大きすぎます。",
  "error.mcp.unsupported": "このサーバーは MCP サーバーに対応していません。",
  "error.mcp.signInOnHost": "MCP サーバーへのサインインは、ホストコンピューターの OpenBot でのみ行えます。",
  "error.mcp.signInAppUnsupported":
    "このサーバーはサインインアプリに対応していません。ホストの OpenBot をアップデートしてください。",
  "error.mcp.redirectRelayed": "OpenBot がサインインをサーバーに送信しました。このウィンドウは閉じてかまいません。",
  "error.mcp.relayEnded": "このサインインは終了しました。もう一度開始してください。",
  "error.mcp.relayNoState":
    "サーバーのサインインページは戻り先アドレスを保護していないため、OpenBot はこのコンピューターでは開きません。",
  "error.mcp.relayAddressInvalid":
    "これはこのサインインの最後のアドレスではありません。ブラウザーからアドレス全体をコピーしてください。",
} as const satisfies PartialTranslation<typeof source>;
