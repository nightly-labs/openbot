import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "El controlador de uso del equipo no se inició. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer":
    "El controlador de uso del equipo se detuvo antes de poder responder.",
  "status.computerUse.driverNoAnswer": "El controlador de uso del equipo no respondió. {reason}",
  "status.computerUse.driverStopped": "El controlador de uso del equipo se detuvo.",
  "status.computerUse.unsupported": "El uso del equipo está disponible en macOS, Windows y Linux.",
  "status.computerUse.driverMissing": "Esta versión de OpenBot no incluye un controlador de uso del equipo.",
  "status.computerUse.progressActing": "Usando una aplicación de este equipo…",
  "status.computerUse.progressDeciding": "Decidiendo el siguiente paso en la aplicación…",
} as const satisfies PartialTranslation<typeof source>;
