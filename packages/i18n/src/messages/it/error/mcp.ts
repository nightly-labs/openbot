import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Questo indirizzo non è raggiungibile per nome.",
  "error.mcp.redirectNotSignIn": "Questo indirizzo non fa parte di un accesso.",
  "error.mcp.redirectRefused": "L'accesso è stato rifiutato. Torna a OpenBot e riprova.",
  "error.mcp.redirectNoSignIn": "Nessun accesso è in attesa di questo. Potrebbe essere terminato.",
  "error.mcp.redirectSignedIn": "OpenBot ha effettuato l'accesso. Puoi chiudere questa finestra.",
  "error.mcp.signInFileUnreadable": "Il file di accesso MCP non è leggibile.",
  "error.mcp.signInFileTooLarge": "Il file di accesso MCP è troppo grande.",
  "error.mcp.unsupported": "I server MCP non sono supportati da questo server.",
  "error.mcp.signInOnHost": "L'accesso a un server MCP funziona solo in OpenBot sul computer host.",
  "error.mcp.signInAppUnsupported": "Questo server non supporta le app di accesso. Aggiorna OpenBot sull'host.",
  "error.mcp.redirectRelayed": "OpenBot ha inviato l'accesso al server. Puoi chiudere questa finestra.",
  "error.mcp.relayEnded": "Questo accesso è terminato. Avvialo di nuovo.",
  "error.mcp.relayNoState":
    "La pagina di accesso del server non protegge il proprio indirizzo di ritorno, quindi OpenBot non la apre su questo computer.",
  "error.mcp.relayAddressInvalid":
    "Questo non è l'indirizzo alla fine di questo accesso. Copia l'indirizzo completo dal browser.",
} as const satisfies PartialTranslation<typeof source>;
