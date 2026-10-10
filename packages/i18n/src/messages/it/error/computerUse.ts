import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Questa build di OpenBot non ha nessuna applicazione da trascinare.",
  "error.computerUse.helpWindowChanged":
    "La finestra di aiuto sui permessi è cambiata prima dell'inizio del trascinamento.",
  "error.computerUse.noAppToShow": "Questa build di OpenBot non ha nessuna applicazione da mostrare.",
  "error.computerUse.noDriver": "Questo computer non ha un driver per Controllo del computer.",
  "error.computerUse.socketPathTooLong":
    "Il percorso del socket di Controllo del computer è di {length} caratteri, e questo sistema ne consente {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "La directory del socket di Controllo del computer {path} non è una directory.",
  "error.computerUse.socketDirectoryOtherOwner":
    "La directory del socket di Controllo del computer {path} appartiene a un altro utente.",
  "error.computerUse.socketDirectoryShared":
    "La directory del socket di Controllo del computer {path} è accessibile ad altri utenti.",
  "error.computerUse.socketNotReady": "Non ha accettato una connessione entro {seconds} secondi. {reason}",
} as const satisfies PartialTranslation<typeof source>;
