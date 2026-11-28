import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Ta kompilacja OpenBot nie ma aplikacji do przeciągnięcia.",
  "error.computerUse.helpWindowChanged": "Okno pomocy uprawnień zmieniło się przed rozpoczęciem przeciągania.",
  "error.computerUse.noAppToShow": "Ta kompilacja OpenBot nie ma aplikacji do pokazania.",
  "error.computerUse.noDriver": "Ten komputer nie ma sterownika Sterowania komputerem.",
  "error.computerUse.socketPathTooLong":
    "Ścieżka gniazda Sterowania komputerem ma {length} znaków, a ten system dopuszcza {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "Katalog gniazda Sterowania komputerem {path} nie jest katalogiem.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Katalog gniazda Sterowania komputerem {path} należy do innego użytkownika.",
  "error.computerUse.socketDirectoryShared":
    "Katalog gniazda Sterowania komputerem {path} jest dostępny dla innych użytkowników.",
  "error.computerUse.socketNotReady": "Nie przyjął połączenia w ciągu {seconds} s. {reason}",
} as const satisfies PartialTranslation<typeof source>;
