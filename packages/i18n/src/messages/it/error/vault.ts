import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/vault";

export const messages = {
  "error.vault.unavailable": "Questo computer non ha archivio segreto, quindi il Vault non può salvare elementi.",
  "error.vault.unreadable": "Il file del Vault non è leggibile. Reimposta il Vault per usarlo di nuovo.",
  "error.vault.tooLarge": "Il Vault è pieno. Elimina alcuni elementi, poi riprova.",
  "error.vault.itemMissing": "Questo elemento non è più nel Vault.",
  "error.vault.valueTooLong": "Un valore è troppo lungo.",
  "error.vault.websiteInvalid": "Inserisci un indirizzo sito HTTPS.",
  "error.vault.passwordRequired": "Inserisci una password.",
  "error.vault.twoStepKeyInvalid":
    "Questa non è una chiave a due fattori. Inserisci la chiave di configurazione o il link otpauth:// del sito.",
  "error.vault.cardNumberInvalid": "Inserisci un numero di carta valido.",
  "error.vault.securityCodeInvalid": "Inserisci un codice di sicurezza di 3 o 4 cifre.",
  "error.vault.expiryInvalid": "Inserisci mese e anno di scadenza validi.",
  "error.vault.contactEmpty": "Inserisci un nome, un indirizzo, un telefono o un'email.",
  "error.vault.contactMissing": "Il contatto di fatturazione non è più nel Vault.",
  "error.vault.apiKeyRequired": "Inserisci una chiave API.",
  "error.vault.apiKeyNameInvalid":
    "Inserisci un nome variabile con lettere maiuscole A–Z, cifre e _, che inizi con una lettera, ad esempio OPENAI_API_KEY.",
  "error.vault.apiKeyNameTaken": "Nel Vault esiste già una chiave API con questo nome variabile.",
  "error.vault.apiKeyAgentTaken": "Un agente che hai scelto ha già una chiave API con questo nome variabile.",
  "error.vault.agentsRequired": "Scegli almeno un agente.",
  "error.vault.csvInvalid": "Questo file non è un'esportazione password in formato CSV.",
  "error.vault.csvTooLarge": "Il file CSV è troppo grande.",
} as const satisfies PartialTranslation<typeof source>;
