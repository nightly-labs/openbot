import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Questo indirizzo non è raggiungibile per nome.",
  "error.mcp.redirectGetOnly": "Questo indirizzo risponde solo a GET.",
  "error.mcp.redirectNotSignIn": "Questo indirizzo non fa parte di un accesso.",
  "error.mcp.redirectRefused": "L'accesso è stato rifiutato. Torna a OpenBot e riprova.",
  "error.mcp.redirectNoSignIn": "Nessun accesso è in attesa di questo. Potrebbe essere terminato.",
  "error.mcp.redirectSignedIn": "OpenBot ha effettuato l'accesso. Puoi chiudere questa finestra.",
  "error.mcp.signInFileUnreadable": "Il file di accesso MCP non è leggibile.",
  "error.mcp.signInFileTooLarge": "Il file di accesso MCP è troppo grande.",
  "error.mcp.unsupported": "I server MCP non sono supportati da questo server.",
  "error.mcp.signInOnHost": "L'accesso a un server MCP funziona solo in OpenBot sul computer host.",
} as const satisfies PartialTranslation<typeof source>;
