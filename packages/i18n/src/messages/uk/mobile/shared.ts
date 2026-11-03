import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/shared";

export const messages = {
  "mobile.shared.crop.choose": "Вибрати",
  "mobile.shared.crop.label": "Кадрування фото",
  "mobile.shared.crop.hint": "Перетягніть, щоб посунути фото. Зведіть або розведіть пальці, щоб змінити масштаб.",
  "mobile.shared.splash.loading": "Завантаження облікового запису",
  "mobile.shared.photo.openFailed": "Не вдалося відкрити фото. Спробуйте ще раз.",
  "mobile.shared.photo.tooLarge": "OpenBot не вдалося достатньо зменшити це фото. Виберіть простіше фото.",
  "mobile.shared.save.changes": "Зберегти зміни",
} as const satisfies PartialTranslation<typeof source>;
