import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Il driver del Controllo del computer non si è avviato. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "Il driver del Controllo del computer si è fermato prima di poter rispondere.",
  "status.computerUse.driverNoAnswer": "Il driver del Controllo del computer non ha risposto. {reason}",
  "status.computerUse.driverStopped": "Il driver del Controllo del computer si è fermato.",
  "status.computerUse.unsupported": "Il Controllo del computer è disponibile su macOS, Windows e Linux.",
  "status.computerUse.driverMissing": "Questa versione di OpenBot non include il driver del Controllo del computer.",
  "status.computerUse.inputRefused":
    "Su questo desktop, OpenBot non può scrivere o fare clic in altre app. Per le attività sui siti web, chiedi all’agente di usare il browser di OpenBot.",
  "status.computerUse.progressActing": "Uso di un'app su questo computer…",
  "status.computerUse.progressDeciding": "Scelta del prossimo passo nell'app…",
} as const satisfies PartialTranslation<typeof source>;
