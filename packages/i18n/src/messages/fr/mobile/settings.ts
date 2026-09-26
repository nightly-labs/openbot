import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/settings";

export const messages = {
  "mobile.settings.saveFailed": "Impossible d’enregistrer ce réglage. Réessayez.",
  "mobile.settings.language.title": "Langue",
  "mobile.settings.language.row": "Langue de l’app",
  "mobile.settings.language.system": "Langue du système",
  "mobile.settings.language.footer":
    "Langue du système suit la première langue des réglages du téléphone. Le texte pas encore traduit s’affiche en anglais.",
  "mobile.settings.dictation.language": "Langue de dictée",
} as const satisfies PartialTranslation<typeof source>;
