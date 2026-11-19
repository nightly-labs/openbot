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
  "status.provider.modelRetryUnreachable":
    "{provider} kann keine Verbindung zum Modellanbieter herstellen. Neuer Versuch: {attempt}.",
  "status.provider.modelRetryServerError":
    "Der Modellanbieter ist ausgelastet oder hat einen Fehler. {provider} versucht es erneut: Versuch {attempt}.",
  "status.provider.modelRetryOutOfMemory":
    "Dem Modellserver ist für diesen Chat der Speicher ausgegangen. {provider} versucht es erneut: Versuch {attempt}. Ein neuer Chat braucht weniger Speicher.",
  "status.provider.modelRetryRecovered": "Der Modellanbieter antwortet wieder.",
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
  "status.provider.claudeOwnApiKey":
    "Claude Code ist so eingestellt, dass es einen Anthropic-API-Schlüssel nutzt. Anthropic rechnet jede Anfrage über das API-Guthaben des Schlüssels ab, nicht über deinen Claude-Plan. Um deinen Plan zu nutzen, entferne den Schlüssel aus den Claude Code-Einstellungen oder den Umgebungsvariablen und starte OpenBot dann neu.",
} as const satisfies PartialTranslation<typeof source>;
