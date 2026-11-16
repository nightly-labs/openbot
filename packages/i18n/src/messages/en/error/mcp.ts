import { defineMessages } from "../../../message";

export const messages = defineMessages("error.mcp", {
  // MCP sign-in errors, and the sign-in page in the browser.
  "error.mcp.redirectByName": "This address is not reachable by name.",
  "error.mcp.redirectNotSignIn": "This address is not part of a sign-in.",
  "error.mcp.redirectRefused": "The sign-in was refused. Go back to OpenBot and try again.",
  "error.mcp.redirectNoSignIn": "No sign-in is waiting for this. It may have ended.",
  "error.mcp.redirectSignedIn": "OpenBot is signed in. You can close this window.",
  "error.mcp.signInFileUnreadable": "The MCP sign-in file is unreadable.",
  "error.mcp.signInFileTooLarge": "The MCP sign-in file is too large.",
  "error.mcp.unsupported": "MCP servers are not supported by this server.",
  "error.mcp.signInOnHost": "Sign-in to an MCP server works only in OpenBot on the host computer.",
  "error.mcp.signInAppUnsupported": "This server does not support sign-in apps. Update OpenBot on the host.",
  "error.mcp.redirectRelayed": "OpenBot sent the sign-in to the server. You can close this window.",
  "error.mcp.relayEnded": "This sign-in ended. Start it again.",
  "error.mcp.relayNoState":
    "The server's sign-in page does not protect its return address, so OpenBot does not open it on this computer.",
  "error.mcp.relayAddressInvalid":
    "This is not the address at the end of this sign-in. Copy the full address from the browser.",
});
