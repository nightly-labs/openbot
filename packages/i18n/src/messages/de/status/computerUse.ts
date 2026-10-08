import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Der Treiber für die Computersteuerung wurde nicht gestartet. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "Der Treiber für die Computersteuerung wurde gestoppt, bevor er antworten konnte.",
  "status.computerUse.driverNoAnswer": "Der Treiber für die Computersteuerung hat nicht geantwortet. {reason}",
  "status.computerUse.driverStopped": "Der Treiber für die Computersteuerung wurde gestoppt.",
  "status.computerUse.unsupported": "Die Computersteuerung ist unter macOS, Windows und Linux verfügbar.",
  "status.computerUse.driverMissing": "Diese Version von OpenBot enthält keinen Treiber für die Computersteuerung.",
  "status.computerUse.progressActing": "Eine App auf diesem Computer wird verwendet…",
  "status.computerUse.progressDeciding": "Der nächste Schritt in der App wird bestimmt…",
} as const satisfies PartialTranslation<typeof source>;
