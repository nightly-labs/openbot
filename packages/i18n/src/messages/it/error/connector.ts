import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Questa build di OpenBot non ha una GitHub App.",
  "error.connector.githubDenied": "L'accesso a GitHub è stato rifiutato.",
  "error.connector.githubCodeExpired": "Il codice di GitHub è scaduto. Connetti di nuovo GitHub.",
  "error.connector.githubDeviceFlowDisabled": "La GitHub App non consente l'accesso tramite dispositivo.",
  "error.connector.githubClientUnknown": "GitHub non riconosce il Client ID di questa GitHub App.",
  "error.connector.githubUnexpected": "GitHub ha inviato una risposta inattesa: {detail}",
  "error.connector.githubUnreachable": "OpenBot non riesce a raggiungere GitHub: {detail}",
  "error.connector.githubExpired": "La connessione a GitHub è scaduta. Connetti di nuovo GitHub.",
  "error.connector.githubFileUnreadable": "Il file di connessione a GitHub non è leggibile.",
  "error.connector.githubFileTooLarge": "Il file di connessione a GitHub è troppo grande.",
  "error.connector.onePasswordCliMissing":
    "OpenBot non trova la CLI di 1Password. Installala e attiva la sua integrazione nell'app 1Password, oppure usa un token di service account.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot non è riuscito a installare la CLI di 1Password. Controlla la connessione a internet e riprova.",
  "error.connector.onePasswordCliSignedOut":
    "La CLI di 1Password non ha effettuato l'accesso. Attiva la sua integrazione nell'app 1Password, poi connetti di nuovo.",
  "error.connector.onePasswordCliFailed": "La CLI di 1Password è fallita: {detail}",
  "error.connector.onePasswordUnexpected": "1Password ha inviato una risposta inattesa: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password non ha accettato il token del service account.",
  "error.connector.onePasswordNoVault":
    "Il service account non può leggere nessun vault. Dagli accesso a un vault e riprova.",
  "error.connector.onePasswordFileUnreadable": "Il file di connessione a 1Password non è leggibile.",
  "error.connector.onePasswordFileTooLarge": "Il file di connessione a 1Password è troppo grande.",
  "error.connector.bitwardenFailed":
    "Impossibile leggere Bitwarden. Installa la CLI bw, accedi, sbloccala e crea una cartella chiamata Shared with OpenBot. Connetti con una nuova chiave di sessione.",
  "error.connector.bitwardenHostInput":
    "Inserisci un indirizzo del server HTTPS, client_id e client_secret della chiave API e la password principale.",
  "error.connector.bitwardenHostFailed":
    "Impossibile aprire Bitwarden su questo server. Controlla l’indirizzo del server, la chiave API e la password principale, e verifica che una cartella si chiami Shared with OpenBot. Poi connetti di nuovo.",
  "error.connector.bitwardenCliInstallFailed":
    "Impossibile installare la CLI di Bitwarden su questo server. Controlla la sua connessione di rete, poi connetti di nuovo.",
  "error.connector.bitwardenFileUnreadable": "Il file di connessione di Bitwarden non è leggibile.",
  "error.connector.telegramAccountCredentialsMissing":
    "Inserisci l'api_id e l'api_hash della tua app Telegram. Li trovi su my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "L'api_id è un numero e l'api_hash ha 32 caratteri tra 0-9 e a-f. Copiali di nuovo da my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram non accetta questi api_id e api_hash. Copiali di nuovo da my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Inserisci il numero di telefono con il prefisso internazionale, per esempio +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram non riconosce questo numero. Includi il prefisso internazionale, per esempio +48.",
  "error.connector.telegramAccountCodeInvalid": "Questo codice non è corretto. Controllalo e riprova.",
  "error.connector.telegramAccountCodeEmpty": "Inserisci il codice che Telegram ti ha inviato.",
  "error.connector.telegramAccountCodeExpired": "Il codice è scaduto. Ricomincia per ricevere un nuovo codice.",
  "error.connector.telegramAccountPasswordInvalid": "Questa password non è corretta. Riprova.",
  "error.connector.telegramAccountPasswordEmpty": "Inserisci la password della verifica in due passaggi.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram richiede la password della verifica in due passaggi.",
  "error.connector.telegramAccountNoAccount":
    "Questo numero non ha un account Telegram. Accedi con un numero che usa già Telegram.",
  "error.connector.telegramAccountPhoneBanned": "Telegram ha bloccato questo numero.",
  "error.connector.telegramAccountQrExpired": "Il codice QR è scaduto prima della scansione. Ricomincia.",
  "error.connector.telegramAccountFloodWait": "Telegram ti chiede di attendere. Riprova tra {count} min.",
  "error.connector.telegramAccountCancelled": "L'accesso a Telegram è stato annullato.",
  "error.connector.telegramAccountTimedOut": "L'accesso si è interrotto dopo 10 minuti senza attività. Ricomincia.",
  "error.connector.telegramAccountMovedOn": "L'accesso è passato a un altro passaggio. Ricomincia.",
  "error.connector.telegramAccountRefused": "Telegram ha rifiutato l'accesso: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot non è riuscito a salvare la connessione a Telegram: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram ha chiuso questa sessione, per esempio in Impostazioni > Dispositivi. Connetti di nuovo il tuo account Telegram.",
  "error.connector.telegramAccountFileUnreadable": "Il file di connessione dell'account Telegram non è leggibile.",
  "error.connector.telegramAccountFileTooLarge": "Il file di connessione dell'account Telegram è troppo grande.",
  "error.connector.whatsappAccountPhoneFormat":
    "Inserisci il numero di telefono con il prefisso internazionale, per esempio +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp non ha fornito un codice: {detail}",
  "error.connector.whatsappAccountQrExpired": "Il codice è scaduto prima che lo usassi. Ricomincia.",
  "error.connector.whatsappAccountTimedOut":
    "Il collegamento si è interrotto dopo 10 minuti senza attività. Ricomincia.",
  "error.connector.whatsappAccountMovedOn": "Il collegamento è passato a un altro passaggio. Ricomincia.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp non ha collegato questo dispositivo: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot non è riuscito a salvare la connessione a WhatsApp: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp ha rimosso questo dispositivo, per esempio in Impostazioni > Dispositivi collegati. Collega di nuovo il tuo account WhatsApp.",
  "error.connector.whatsappAccountReplaced":
    "Un altro programma ha aperto questo dispositivo collegato, quindi WhatsApp ha chiuso la connessione qui. Scollega, poi collega di nuovo.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp ha rifiutato questo dispositivo. Il tuo numero potrebbe essere limitato. Controlla WhatsApp sul telefono.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp non accetta più questa versione della connessione. Aggiorna OpenBot, poi collega di nuovo.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp non è raggiungibile ora. OpenBot riprova. Gli agenti possono ancora leggere le chat su questo computer.",
  "error.connector.whatsappAccountFileUnreadable": "Il file di connessione dell'account WhatsApp non è leggibile.",
} as const satisfies PartialTranslation<typeof source>;
