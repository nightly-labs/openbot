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
  "status.provider.modelRetryUnreachable":
    "{provider} non riesce a connettersi al fornitore del modello. Riprova: tentativo {attempt}.",
  "status.provider.modelRetryServerError":
    "Il fornitore del modello è occupato o ha un errore. {provider} riprova: tentativo {attempt}.",
  "status.provider.modelRetryOutOfMemory":
    "Il server del modello ha esaurito la memoria per questa chat. {provider} riprova: tentativo {attempt}. Una nuova chat richiede meno memoria.",
  "status.provider.modelRetryRecovered": "Il fornitore del modello risponde di nuovo.",
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
  "status.provider.claudeOwnApiKey":
    "Claude Code è impostato per usare una chiave API di Anthropic. Anthropic addebita ogni richiesta sul credito API della chiave, non sul tuo piano Claude. Per usare il tuo piano, rimuovi la chiave dalle impostazioni di Claude Code o dalle variabili d'ambiente, poi riavvia OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
