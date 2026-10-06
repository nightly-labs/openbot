import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Escolher",
  "mobile.shared.crop.label": "Recorte da foto",
  "mobile.shared.crop.hint": "Arraste para mover a foto. Use o gesto de pinça para redimensioná-la.",
  "mobile.shared.splash.loading": "Carregando conta",
  "mobile.shared.photo.openFailed": "Não foi possível abrir esta foto. Tente novamente.",
  "mobile.shared.photo.tooLarge":
    "O OpenBot não conseguiu reduzir esta foto o suficiente. Escolha uma foto mais simples.",
  "mobile.shared.save.changes": "Salvar alterações",
} as const satisfies PartialTranslation<typeof source>;
