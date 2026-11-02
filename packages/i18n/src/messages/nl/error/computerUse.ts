import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Deze build van OpenBot heeft geen app om te slepen.",
  "error.computerUse.helpWindowChanged": "Het hulpvenster voor toestemmingen is gewijzigd voordat het slepen begon.",
  "error.computerUse.noAppToShow": "Deze build van OpenBot heeft geen app om te tonen.",
  "error.computerUse.noDriver": "Deze computer heeft geen driver voor Computerbesturing.",
  "error.computerUse.socketPathTooLong":
    "Het socketpad van Computerbesturing is {length} tekens lang, en dit systeem staat {limit} toe.",
  "error.computerUse.socketDirectoryNotDirectory": "De socketmap {path} van Computerbesturing is geen map.",
  "error.computerUse.socketDirectoryOtherOwner":
    "De socketmap {path} van Computerbesturing is van een andere gebruiker.",
  "error.computerUse.socketDirectoryShared":
    "De socketmap {path} van Computerbesturing is toegankelijk voor andere gebruikers.",
  "error.computerUse.socketNotReady": "Er is binnen {seconds} seconden geen verbinding geaccepteerd. {reason}",
} as const satisfies PartialTranslation<typeof source>;
