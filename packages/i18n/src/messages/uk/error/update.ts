import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Оновлення доступні у встановлених збірках для комп’ютера.",
  "error.update.notReady": "Оновлення не готове до встановлення.",
  "error.update.restartFailed": "OpenBot не вдалося перезапуститися, щоб установити оновлення.",
  "error.update.downloadStalled": "Завантаження оновлення перестало відповідати. Спробуйте ще раз.",
  "error.update.installFailed":
    "Не вдалося встановити оновлення. Закрийте й знову відкрийте OpenBot, потім спробуйте ще раз.",
  "error.update.downloadFailed": "Не вдалося завантажити оновлення. Спробуйте ще раз.",
  "error.update.checkFailed": "Не вдалося перевірити наявність оновлень. Спробуйте ще раз.",
  "error.update.checkStalled": "Перевірка оновлень перестала відповідати. Спробуйте ще раз.",
  "error.update.checkOffline":
    "Не вдалося зв’язатися зі службою оновлень. Перевірте з’єднання з інтернетом і спробуйте ще раз.",
  "error.update.checkUnavailable": "Служба оновлень не відповіла. OpenBot сам спробує ще раз за кілька хвилин.",
  "error.update.checkNoRelease":
    "Для цієї платформи не знайдено опублікованих оновлень. OpenBot сам спробує ще раз за кілька хвилин.",
  "error.update.managedByNix": "Оновлення цієї копії OpenBot встановлює Nix. Оновіть її через Nix.",
  "error.update.managedByHost":
    "Оновлення на цьому Mac встановлює хост. Оновлення залишається готовим до початку обслуговування хоста.",
  "error.update.siblingSession":
    "З цього застосунку досі запущено інший сеанс OpenBot. Спершу зупиніть OpenBot в усіх інших облікових записах macOS, потім установіть оновлення знову.",
  "error.update.siblingSessionSameAccount":
    "У цьому обліковому записі досі працює інший процес OpenBot. Завершіть його, потім установіть оновлення знову.",
  "error.update.siblingCheckFailed": "Не вдалося перевірити інші сеанси OpenBot. Спробуйте ще раз перед установленням.",
  "error.update.remoteDisabled": "Оновлення від адміністраторів сервера вимкнено на цьому комп’ютері.",
  "error.update.restartStarted": "OpenBot уже перезапускається, щоб установити оновлення.",
  "error.update.alreadyRestarting": "OpenBot уже перезапускається.",
} as const satisfies PartialTranslation<typeof source>;
