import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Impossibile connettersi. Controlla la connessione e riprova.",
  "error.kind.timeout":
    "La richiesta ha richiesto troppo tempo. Controlla se l'azione è stata completata prima di riprovare.",
  "error.kind.storage":
    "Lo spazio di archiviazione non è sufficiente. Libera spazio sul computer su cui gira OpenBot, poi riprova.",
  "error.kind.filePermission":
    "OpenBot non ha il permesso di completare questa azione. Controlla i permessi del file o della cartella, poi riprova.",
  "error.kind.notFound":
    "Non è stato possibile trovare un file o una cartella necessari. Ripristinali o scegline un altro, poi riprova.",
  "error.kind.readOnly": "Questa cartella è di sola lettura. Scegli una cartella in cui puoi scrivere, poi riprova.",
  "error.kind.conflict": "Esiste già un elemento con questo nome. Scegli un nome diverso, poi riprova.",
  "error.kind.auth": "Autenticazione non riuscita. Controlla il tuo account o la connessione al server, poi riprova.",
  "error.kind.permission": "Non hai il permesso di completare questa azione. Chiedi l'accesso al proprietario.",
  "error.kind.rateLimit": "Troppe richieste. Attendi un momento, poi riprova.",
  "error.kind.service": "Il servizio non è disponibile. Attendi un momento, poi riprova.",
} as const satisfies PartialTranslation<typeof source>;
