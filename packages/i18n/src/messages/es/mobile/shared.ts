import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Elegir",
  "mobile.shared.crop.label": "Recorte de foto",
  "mobile.shared.crop.hint": "Arrastra para mover la foto. Pellizca para cambiar su tamaño.",
  "mobile.shared.splash.loading": "Cargando cuenta",
  "mobile.shared.photo.openFailed": "No se pudo abrir esta foto. Vuelve a intentarlo.",
  "mobile.shared.photo.tooLarge": "OpenBot no pudo reducir esta foto lo suficiente. Elige una foto más sencilla.",
  "mobile.shared.save.changes": "Guardar cambios",
} as const satisfies PartialTranslation<typeof source>;
