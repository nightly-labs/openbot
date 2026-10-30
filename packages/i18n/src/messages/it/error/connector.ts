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
} as const satisfies PartialTranslation<typeof source>;
