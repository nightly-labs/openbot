import { defineMessages } from "../../../message";

export const messages = defineMessages("error.mcp", {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "This address is not reachable by name.",
  "error.mcp.redirectGetOnly": "This address answers GET only.",
  "error.mcp.redirectNotSignIn": "This address is not part of a sign-in.",
  "error.mcp.redirectRefused": "The sign-in was refused. Go back to OpenBot and try again.",
  "error.mcp.redirectNoSignIn": "No sign-in is waiting for this. It may have ended.",
  "error.mcp.redirectSignedIn": "OpenBot is signed in. You can close this window.",
  "error.mcp.signInFileUnreadable": "The MCP sign-in file is unreadable.",
  "error.mcp.signInFileTooLarge": "The MCP sign-in file is too large.",
  "error.mcp.unsupported": "MCP servers are not supported by this server.",
});
