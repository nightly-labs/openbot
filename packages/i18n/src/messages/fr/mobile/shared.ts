import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Choisir",
  "mobile.shared.crop.label": "Recadrage de la photo",
  "mobile.shared.crop.hint": "Faites glisser pour déplacer la photo. Pincez pour la redimensionner.",
  "mobile.shared.splash.loading": "Chargement du compte",
  "mobile.shared.photo.openFailed": "Impossible d’ouvrir cette photo. Réessayez.",
  "mobile.shared.photo.tooLarge":
    "OpenBot n’a pas pu réduire suffisamment cette photo. Choisissez une photo plus simple.",
  "mobile.shared.save.changes": "Enregistrer les modifications",
} as const satisfies PartialTranslation<typeof source>;
