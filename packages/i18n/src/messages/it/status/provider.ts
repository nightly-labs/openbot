import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download interrotto. Riprova.",
  "status.provider.downloadFailed": "Download non riuscito. Riprova.",
  "status.provider.updateWaiting": "L'aggiornamento parte quando finisce il turno in corso.",
  "status.provider.confirmContinue": "Continua",
  "status.provider.confirmCancel": "Annulla",
  "status.provider.retryUnreachable":
    "{provider} non riesce a connettersi al suo server. Tentativo {attempt} di {maxAttempts}.",
  "status.provider.retryServerError":
    "Il server di {provider} è occupato o ha un errore. Tentativo {attempt} di {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} riceve di nuovo risposte dal suo server.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude ha risposto alla velocità standard. Con un abbonamento Claude, la modalità veloce usa i crediti di utilizzo. Attivali nel tuo account Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude ha risposto alla velocità standard. Il tuo piano Claude non include la modalità veloce.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude ha risposto alla velocità standard. La modalità veloce funziona solo con una chiave API Anthropic o un abbonamento Claude, non con Bedrock, Vertex, Foundry o un gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude ha risposto alla velocità standard. Questo modello non può usare la modalità veloce sul tuo account.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude ha risposto alla velocità standard. La modalità veloce è disattivata nelle impostazioni di Claude Code o dalla tua organizzazione.",
  "status.provider.claudeFastModeUnavailable":
    "Claude ha risposto alla velocità standard. Claude Code non ha potuto usare la modalità veloce per questo turno.",
} as const satisfies PartialTranslation<typeof source>;
