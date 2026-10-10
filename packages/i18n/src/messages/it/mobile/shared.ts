import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Scegli",
  "mobile.shared.crop.label": "Ritaglio della foto",
  "mobile.shared.crop.hint": "Trascina per spostare la foto. Pizzica per ingrandirla.",
  "mobile.shared.splash.loading": "Caricamento dell'account",
  "mobile.shared.photo.openFailed": "Impossibile aprire questa foto. Riprova.",
  "mobile.shared.photo.tooLarge":
    "OpenBot non è riuscito a rendere questa foto abbastanza piccola. Scegli una foto più semplice.",
  "mobile.shared.save.changes": "Salva modifiche",
} as const satisfies PartialTranslation<typeof source>;
