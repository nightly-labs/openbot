import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "La configurazione dei permessi è disponibile su macOS.",
  "status.remote.setupInstallHost": "Installa il componente host del desktop remoto, poi controlla di nuovo.",
  "status.remote.setupUpdateRuntime": "Aggiorna il runtime del desktop remoto per controllare i permessi di macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine non ha potuto completare il controllo dei permessi. Controlla la sessione dell'host, poi riprova.",
  "status.remote.setupServiceFailed":
    "Impossibile avviare il servizio del desktop remoto. Controlla che questo utente macOS abbia una sessione grafica attiva.",
  "status.remote.connectingSunshine": "Connessione tramite Sunshine…",
  "status.remote.switchingMonitor": "Cambio del monitor condiviso…",
  "status.remote.controlConnected": "Controllo remoto connesso.",
  "status.remote.controlFailed": "Controllo remoto non riuscito.",
  "status.remote.stagePreferences": "Caricamento delle preferenze locali della chat: {reason}",
  "status.remote.stageConnection": "Connessione al desktop: {reason}",
  "status.remote.stageCompatibility": "Controllo della compatibilità del desktop: {reason}",
  "status.remote.stageAgents": "Caricamento degli agenti: {reason}",
  "status.remote.stageReads": "Caricamento dello stato di lettura: {reason}",
  "status.remote.stageConversations": "Caricamento delle conversazioni: {reason}",
  "status.remote.suspendedDetail": "Aggiorna OpenBot Mobile o l'app desktop prima di connetterti.\n{detail}",
  "status.remote.cooldownDetail":
    "Connessione non riuscita dopo {limit} tentativi. Nuovo tentativo tra {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Connessione non riuscita dopo {limit} tentativi. Nuovo tentativo tra {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Connessione persa. Nuovo tentativo tra {count} s.\n{detail}",
    other: "Connessione persa. Nuovo tentativo tra {count} s.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Connessione persa. Nuovo tentativo tra {count} s.",
    other: "Connessione persa. Nuovo tentativo tra {count} s.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.\n{detail}",
    other: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.",
    other: "Tentativo di connessione non riuscito. Nuovo tentativo tra {count} s.",
  },
  "status.remote.reconnectingDetail": {
    one: "Riconnessione {attempt}/{count}\n{detail}",
    other: "Riconnessione {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": { one: "Riconnessione {attempt}/{count}", other: "Riconnessione {attempt}/{count}" },
} as const satisfies PartialTranslation<typeof source>;
