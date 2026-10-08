import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Auswählen",
  "mobile.shared.crop.label": "Bildausschnitt",
  "mobile.shared.crop.hint": "Ziehe, um das Bild zu bewegen. Ziehe mit zwei Fingern, um die Größe zu ändern.",
  "mobile.shared.splash.loading": "Konto wird geladen",
  "mobile.shared.photo.openFailed": "Dieses Bild konnte nicht geöffnet werden. Versuche es erneut.",
  "mobile.shared.photo.tooLarge":
    "OpenBot konnte dieses Bild nicht ausreichend verkleinern. Wähle ein einfacheres Bild.",
  "mobile.shared.save.changes": "Änderungen speichern",
} as const satisfies PartialTranslation<typeof source>;
