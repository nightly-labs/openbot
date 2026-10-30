import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Kies",
  "mobile.shared.crop.label": "Foto bijsnijden",
  "mobile.shared.crop.hint": "Sleep om de foto te verplaatsen. Knijp om te schalen.",
  "mobile.shared.splash.loading": "Account laden",
  "mobile.shared.photo.openFailed": "Kan deze foto niet openen. Probeer opnieuw.",
  "mobile.shared.photo.tooLarge": "OpenBot kan deze foto niet klein genoeg maken. Kies een eenvoudigere foto.",
  "mobile.shared.save.changes": "Wijzigingen opslaan",
} as const satisfies PartialTranslation<typeof source>;
