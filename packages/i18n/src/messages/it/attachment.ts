import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Apri il file",
  "attachment.preview": "Anteprima di {name}",
  "attachment.notFound": "File non trovato",
  "attachment.download": "Scarica {name}",
  "attachment.open": "Apri {name}",
  "attachment.previewUnavailable": "L'anteprima non è disponibile.",
  "attachment.error.preview": "Impossibile mostrare l'anteprima di {name}. Riprova.",
  "attachment.error.download": "Impossibile scaricare gli allegati. Riprova.",
  "attachment.error.open": "Impossibile aprire o salvare questo allegato. Riprova.",
  "attachment.error.openFile": "Impossibile aprire questo file. Riprova.",
  "attachment.error.fileFallback": "File",
  "attachment.error.fileNotFound":
    "«{name}» non è stato trovato in questo percorso. Potrebbe essere stato spostato o eliminato.",
  "attachment.error.previewFile": "Impossibile mostrare l'anteprima di «{name}». Riprova.",
} as const satisfies PartialTranslation<typeof source>;
