import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Non connesso",
  "mobile.workspace.status.online": "Online",
  "mobile.workspace.status.offline": "Offline",
  "mobile.workspace.status.error": "Errore di connessione",
  "mobile.workspace.status.reconnecting": "Riconnessione",
  "mobile.workspace.status.attempt": "Tentativo {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Tentativo ",
  "mobile.workspace.status.retryIn": "Riprova tra {seconds} secondi",
  "mobile.workspace.section.agents": "Agenti",
  "mobile.workspace.error.directoryUnavailable": "La cartella del server non è disponibile.",
  "mobile.workspace.error.sectionsLoadFailed": "Impossibile caricare le sezioni. Riprova.",
  "mobile.workspace.error.transportNotReady": "Il trasporto mobile non è pronto.",
  "mobile.workspace.error.sectionsUnsupported": "Questo host non supporta la modifica delle sezioni.",
  "mobile.workspace.error.leaveOwnServer": "Puoi uscire solo dai server remoti a cui ti sei unito.",
  "mobile.workspace.error.removeOwnedServerOnly": "Solo il proprietario può rimuovere questo server.",
  "mobile.workspace.error.agentNotOnHost": "L'agente non è su questo host.",
  "mobile.workspace.error.filesUnsupported":
    "Questo host non supporta la gestione dei file. Aggiorna OpenBot sull'host.",
  "mobile.workspace.error.agentUnavailableOnHost": "L'agente non è disponibile su questo host.",
  "mobile.workspace.error.agentUnavailable": "L'agente non è disponibile.",
  "mobile.workspace.error.formUnavailable": "Questo modulo non è più disponibile.",
  "mobile.workspace.error.approvalInactive":
    "Questa richiesta non è più in attesa. Ha risposto un altro dispositivo, oppure l'attività si è fermata.",
  "mobile.workspace.error.approvalOffline": "Connettiti al server per rispondere a questa richiesta.",
  "mobile.workspace.alert.preferencesTitle": "Impossibile salvare le preferenze della chat",
  "mobile.workspace.alert.preferencesBody": "Le preferenze precedenti sono state mantenute. Riprova.",
  "mobile.workspace.alert.updateRequiredTitle": "Aggiornamento necessario",
  "mobile.workspace.alert.updateRequiredUnread":
    "Aggiorna questo server desktop per segnare le conversazioni come non lette.",
  "mobile.workspace.alert.markUnreadTitle": "Impossibile segnare come non letta",
  "mobile.workspace.alert.markUnreadBody": "Riconnettiti al server e riprova.",
  "mobile.workspace.alert.markAllReadTitle": "Impossibile segnare tutto come letto",
  "mobile.workspace.alert.markAllReadBody": "Alcune chat sono ancora da leggere. Riconnettiti al server e riprova.",
  "mobile.workspace.alert.serverOrderTitle": "Impossibile salvare l'ordine dei server",
  "mobile.workspace.alert.serverOrderBody": "L'ordine precedente è stato mantenuto. Riprova.",
  "mobile.workspace.error.connectFailed": "Connessione al server non riuscita.",
  "mobile.workspace.error.disconnectFailed": "Il server non si è disconnesso correttamente.",
  "mobile.workspace.error.queueEditRejected": "L'host non ha accettato questa modifica.",
} as const satisfies PartialTranslation<typeof source>;
