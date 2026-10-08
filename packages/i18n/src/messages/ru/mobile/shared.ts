import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Выбрать",
  "mobile.shared.crop.label": "Кадрирование фото",
  "mobile.shared.crop.hint": "Перетащите, чтобы сдвинуть фото. Сведите пальцы, чтобы изменить масштаб.",
  "mobile.shared.splash.loading": "Загрузка аккаунта",
  "mobile.shared.photo.openFailed": "Не удалось открыть фото. Повторите попытку.",
  "mobile.shared.photo.tooLarge": "OpenBot не смог уменьшить это фото. Выберите фото попроще.",
  "mobile.shared.save.changes": "Сохранить изменения",
} as const satisfies PartialTranslation<typeof source>;
