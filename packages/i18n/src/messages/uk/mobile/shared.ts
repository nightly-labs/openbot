import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Wybierz",
  "mobile.shared.crop.label": "Kadrowanie zdjęcia",
  "mobile.shared.crop.hint": "Przeciągnij, aby przesunąć zdjęcie. Zsuń lub rozsuń palce, aby zmienić skalę.",
  "mobile.shared.splash.loading": "Wczytywanie konta",
  "mobile.shared.photo.openFailed": "Nie udało się otworzyć tego zdjęcia. Spróbuj ponownie.",
  "mobile.shared.photo.tooLarge": "OpenBot nie zdołał wystarczająco zmniejszyć tego zdjęcia. Wybierz prostsze zdjęcie.",
  "mobile.shared.save.changes": "Zapisz zmiany",
} as const satisfies PartialTranslation<typeof source>;
