import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Diese Adresse ist nicht über ihren Namen erreichbar.",
  "error.mcp.redirectNotSignIn": "Diese Adresse gehört nicht zu einer Anmeldung.",
  "error.mcp.redirectRefused": "Die Anmeldung wurde abgelehnt. Kehre zu OpenBot zurück und versuche es erneut.",
  "error.mcp.redirectNoSignIn": "Keine Anmeldung wartet darauf. Sie wurde möglicherweise bereits beendet.",
  "error.mcp.redirectSignedIn": "OpenBot ist angemeldet. Du kannst dieses Fenster schließen.",
  "error.mcp.signInFileUnreadable": "Die MCP-Anmeldedatei ist nicht lesbar.",
  "error.mcp.signInFileTooLarge": "Die MCP-Anmeldedatei ist zu groß.",
  "error.mcp.unsupported": "Dieser Server unterstützt keine MCP-Server.",
  "error.mcp.signInOnHost": "Die Anmeldung bei einem MCP-Server funktioniert nur in OpenBot auf dem Host-Computer.",
  "error.mcp.signInAppUnsupported": "Dieser Server unterstützt keine Anmelde-Apps. Aktualisiere OpenBot auf dem Host.",
  "error.mcp.redirectRelayed": "OpenBot hat die Anmeldung an den Server gesendet. Du kannst dieses Fenster schließen.",
  "error.mcp.relayEnded": "Diese Anmeldung ist beendet. Starte sie erneut.",
  "error.mcp.relayNoState":
    "Die Anmeldeseite des Servers schützt ihre Rückkehradresse nicht, darum öffnet OpenBot sie nicht auf diesem Computer.",
  "error.mcp.relayAddressInvalid":
    "Das ist nicht die Adresse am Ende dieser Anmeldung. Kopiere die vollständige Adresse aus dem Browser.",
} as const satisfies PartialTranslation<typeof source>;
