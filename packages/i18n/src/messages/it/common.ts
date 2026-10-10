import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/common";

export const messages = {
  "common.cancel": "Annulla",
  "common.save": "Salva",
  "common.close": "Chiudi",
  "common.delete": "Elimina",
  "common.remove": "Rimuovi",
  "common.edit": "Modifica",
  "common.rename": "Rinomina",
  "common.retry": "Riprova",
  "common.copy": "Copia",
  "common.copied": "Copiato",
  "common.done": "Fine",
  "common.back": "Indietro",
  "common.continue": "Continua",
  "common.add": "Aggiungi",
  "common.create": "Crea",
  "common.open": "Apri",
  "common.search": "Cerca",
  "common.loading": "Caricamento…",
  "common.saving": "Salvataggio…",
  "common.tryAgain": "Riprova",
  "common.connecting": "Connessione…",
  "common.download": "Scarica",
  "common.removing": "Rimozione…",
  "common.sending": "Invio…",
} as const satisfies PartialTranslation<typeof source>;
