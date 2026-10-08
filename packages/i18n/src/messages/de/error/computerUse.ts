import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Diese Version von OpenBot hat keine Anwendung zum Ziehen.",
  "error.computerUse.helpWindowChanged": "Das Hilfefenster für Berechtigungen wurde geändert, bevor das Ziehen begann.",
  "error.computerUse.noAppToShow": "Diese Version von OpenBot hat keine Anwendung zum Anzeigen.",
  "error.computerUse.noDriver": "Dieser Computer hat keinen Treiber für die Computersteuerung.",
  "error.computerUse.socketPathTooLong":
    "Der Socket-Pfad der Computersteuerung hat {length} Zeichen. Dieses System erlaubt {limit}.",
  "error.computerUse.socketDirectoryNotDirectory":
    "Das Socket-Verzeichnis der Computersteuerung {path} ist kein Verzeichnis.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Das Socket-Verzeichnis der Computersteuerung {path} gehört einem anderen Benutzer.",
  "error.computerUse.socketDirectoryShared":
    "Das Socket-Verzeichnis der Computersteuerung {path} ist für andere Benutzer zugänglich.",
  "error.computerUse.socketNotReady": "Innerhalb von {seconds} Sekunden wurde keine Verbindung angenommen. {reason}",
} as const satisfies PartialTranslation<typeof source>;
