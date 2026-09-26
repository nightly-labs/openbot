import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "Cette version d’OpenBot n’a aucune application à faire glisser.",
  "error.computerUse.helpWindowChanged":
    "La fenêtre d’aide sur les autorisations a changé avant le début du glissement.",
  "error.computerUse.noAppToShow": "Cette version d’OpenBot n’a aucune application à afficher.",
  "error.computerUse.noDriver": "Cet ordinateur n’a pas de pilote Computer Use.",
  "error.computerUse.socketPathTooLong":
    "Le chemin du socket Computer Use fait {length} caractères, et ce système en autorise {limit}.",
  "error.computerUse.socketDirectoryNotDirectory": "Le dossier de socket Computer Use {path} n’est pas un dossier.",
  "error.computerUse.socketDirectoryOtherOwner":
    "Le dossier de socket Computer Use {path} appartient à un autre utilisateur.",
  "error.computerUse.socketDirectoryShared":
    "Le dossier de socket Computer Use {path} est accessible à d’autres utilisateurs.",
  "error.computerUse.socketNotReady": "Il n’a accepté aucune connexion en {seconds} secondes. {reason}",
} as const satisfies PartialTranslation<typeof source>;
