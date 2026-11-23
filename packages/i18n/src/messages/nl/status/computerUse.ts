import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "De driver voor Computerbesturing is niet gestart. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "De driver voor Computerbesturing is gestopt voordat hij kon antwoorden.",
  "status.computerUse.driverNoAnswer": "De driver voor Computerbesturing reageerde niet. {reason}",
  "status.computerUse.driverStopped": "De driver voor Computerbesturing is gestopt.",
  "status.computerUse.unsupported": "Computerbesturing is beschikbaar op macOS, Windows en Linux.",
  "status.computerUse.driverMissing": "Deze build van OpenBot bevat geen driver voor Computerbesturing.",
  "status.computerUse.inputRefused":
    "Op dit bureaublad kan OpenBot niet typen of klikken in andere apps. Vraag de agent voor taken op websites om de OpenBot-browser te gebruiken.",
  "status.computerUse.progressActing": "Gebruikt een app op deze computer…",
  "status.computerUse.progressDeciding": "Bepaalt de volgende stap in de app…",
} as const satisfies PartialTranslation<typeof source>;
