import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download gestoppt. Versuche es erneut.",
  "status.provider.downloadFailed": "Download fehlgeschlagen. Versuche es erneut.",
  "status.provider.updateWaiting": "Das Update startet, wenn der aktuelle Durchlauf endet.",
  "status.provider.confirmContinue": "Weiter",
  "status.provider.confirmCancel": "Abbrechen",
  "status.provider.retryUnreachable":
    "{provider} kann keine Verbindung zu seinem Server herstellen. Versuch {attempt} von {maxAttempts}.",
  "status.provider.retryServerError":
    "Der {provider}-Server ist ausgelastet oder hat einen Fehler. Versuch {attempt} von {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} erhält wieder Antworten von seinem Server.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Der Schnellmodus nutzt mit einem Claude-Abo Nutzungsguthaben. Schalte es in deinem Claude-Konto ein.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Dein Claude-Plan enthält den Schnellmodus nicht.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Der Schnellmodus funktioniert nur mit einem Anthropic-API-Schlüssel oder einem Claude-Abo, nicht mit Bedrock, Vertex, Foundry oder einem Gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Dieses Modell kann den Schnellmodus in deinem Konto nicht nutzen.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Der Schnellmodus ist in den Claude Code-Einstellungen oder von deiner Organisation ausgeschaltet.",
  "status.provider.claudeFastModeUnavailable":
    "Claude hat mit normaler Geschwindigkeit geantwortet. Claude Code konnte den Schnellmodus für diesen Turn nicht nutzen.",
} as const satisfies PartialTranslation<typeof source>;
