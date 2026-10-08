import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Diese Adresse ist nicht über ihren Namen erreichbar.",
  "error.mcp.redirectGetOnly": "Diese Adresse beantwortet nur GET.",
  "error.mcp.redirectNotSignIn": "Diese Adresse gehört nicht zu einer Anmeldung.",
  "error.mcp.redirectRefused": "Die Anmeldung wurde abgelehnt. Kehre zu OpenBot zurück und versuche es erneut.",
  "error.mcp.redirectNoSignIn": "Keine Anmeldung wartet darauf. Sie wurde möglicherweise bereits beendet.",
  "error.mcp.redirectSignedIn": "OpenBot ist angemeldet. Du kannst dieses Fenster schließen.",
  "error.mcp.signInFileUnreadable": "Die MCP-Anmeldedatei ist nicht lesbar.",
  "error.mcp.signInFileTooLarge": "Die MCP-Anmeldedatei ist zu groß.",
  "error.mcp.unsupported": "Dieser Server unterstützt keine MCP-Server.",
} as const satisfies PartialTranslation<typeof source>;
