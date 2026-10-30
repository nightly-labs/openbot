import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/mcp";

export const messages = {
  "error.mcp.redirectByName": "Dit adres is niet bereikbaar via een naam.",
  "error.mcp.redirectGetOnly": "Dit adres antwoordt alleen op GET.",
  "error.mcp.redirectNotSignIn": "Dit adres hoort niet bij een inlog.",
  "error.mcp.redirectRefused": "Het inloggen is geweigerd. Ga terug naar OpenBot en probeer het opnieuw.",
  "error.mcp.redirectNoSignIn": "Er wacht geen inlog op dit adres. Misschien is de inlog afgelopen.",
  "error.mcp.redirectSignedIn": "OpenBot is ingelogd. Je kunt dit venster sluiten.",
  "error.mcp.signInFileUnreadable": "Het MCP-inlogbestand is onleesbaar.",
  "error.mcp.signInFileTooLarge": "Het MCP-inlogbestand is te groot.",
  "error.mcp.unsupported": "Deze server ondersteunt geen MCP-servers.",
  "error.mcp.signInOnHost": "Inloggen bij een MCP-server werkt alleen in OpenBot op de hostcomputer.",
  "error.mcp.signInAppUnsupported": "Deze server ondersteunt geen inlogapps. Werk OpenBot bij op de host.",
  "error.mcp.redirectRelayed": "OpenBot heeft de inlog naar de server gestuurd. Je kunt dit venster sluiten.",
  "error.mcp.relayEnded": "Deze inlog is afgelopen. Start opnieuw.",
  "error.mcp.relayNoState":
    "De inlogpagina van de server beschermt het terugkeeradres niet, dus OpenBot opent hem niet op deze computer.",
  "error.mcp.relayAddressInvalid":
    "Dit is niet het adres aan het einde van deze inlog. Kopieer het volledige adres uit de browser.",
} as const satisfies PartialTranslation<typeof source>;
