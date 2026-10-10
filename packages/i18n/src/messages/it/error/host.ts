import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal non ha fornito server ICE.",
  "error.host.webRtcNotConfigured": "Il servizio host WebRTC non è configurato.",
  "error.host.runtimeNotInstalled": "L'ambiente del desktop remoto non è installato.",
  "error.host.setupUnavailable": "La configurazione dei permessi non è disponibile.",
  "error.host.accountChangedDuringUpdate":
    "L'account con cui hai effettuato l'accesso è cambiato durante l'aggiornamento di questo server.",
  "error.host.nameBeforePublish": "Dai un nome a questo OpenBot prima di pubblicarlo.",
  "error.host.memberNotFound": "Il membro remoto non esiste.",
  "error.host.publishBeforeInvite": "Rendi pubblico questo OpenBot prima di creare un invito.",
  "error.host.teamAccessUnavailable": "L'accesso al tuo team non è disponibile.",
  "error.host.ownerIdentityUnavailable": "L'identità del proprietario dell'host non è disponibile.",
  "error.host.reserveAddressFailed": "Impossibile riservare l'indirizzo pubblico.",
  "error.host.publishFailed": "Non è stato possibile pubblicare questo OpenBot.",
  "error.host.mobileConnectPublishFailed": "Non è stato possibile pubblicare questo OpenBot per Mobile Connect.",
  "error.host.mobileConnectHostChanged": "L'host di Mobile Connect è cambiato. Riprova.",
  "error.host.noServer": "Questo computer non ha nessun server da modificare.",
  "error.host.identityLocalOnly": "Il nome e il logo del server si possono cambiare solo sul computer che lo esegue.",
  "error.host.maintenanceInterrupted":
    "Manutenzione dell'host interrotta. Verifica l'applicazione e reimposta lo stato dell'host prima di riprovare.",
  "error.host.updateFailed":
    "L'aggiornamento dell'host è fallito durante {phase}. Verifica proprietà del bundle, firma, stato dei tenant e spazio libero su disco prima di reimpostare lo stato.",
  "error.host.tenantsNotIdle": "I tenant non sono rimasti inattivi per cinque minuti nell'arco di due ore.",
  "error.host.tenantShutdownTimeout":
    "L'arresto dei tenant è scaduto. Non è stata avviata nessuna sostituzione dell'applicazione.",
  "error.host.tenantHealthMissing":
    "I report di salute dei tenant mancano o non sono in buono stato dopo il riavvio. Controlla le sessioni dei tenant prima di un altro aggiornamento.",
} as const satisfies PartialTranslation<typeof source>;
