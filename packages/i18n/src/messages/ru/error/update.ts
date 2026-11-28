import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/update";

export const messages = {
  "error.update.unsupported": "Обновления доступны в установленных сборках для компьютера.",
  "error.update.notReady": "Обновление не готово к установке.",
  "error.update.restartFailed": "OpenBot не смог перезапуститься для установки обновления.",
  "error.update.downloadStalled": "Загрузка обновления перестала отвечать. Повторите попытку.",
  "error.update.installFailed":
    "Не удалось установить обновление. Закройте и снова откройте OpenBot, затем повторите попытку.",
  "error.update.notInstalled": "Последний перезапуск не установил обновление. Перезапустите, чтобы повторить попытку.",
  "error.update.needsAdministrator":
    "OpenBot не смог сам установить обновление, потому что macOS запрашивает пароль администратора для замены OpenBot. Нажмите «Перезапустить» на этом компьютере, затем введите пароль.",
  "error.update.downloadFailed": "Не удалось загрузить обновление. Повторите попытку.",
  "error.update.signatureNotConfirmed":
    "OpenBot не удалось проверить обновление. Повторите попытку. Если ошибка повторяется, скачайте OpenBot на openbot.run/download.",
  "error.update.checkFailed": "Не удалось проверить обновления. Повторите попытку.",
  "error.update.checkStalled": "Проверка обновлений перестала отвечать. Повторите попытку.",
  "error.update.checkOffline":
    "Не удалось связаться со службой обновлений. Проверьте подключение к интернету и повторите попытку.",
  "error.update.checkUnavailable": "Служба обновлений не ответила. OpenBot сам повторит попытку через несколько минут.",
  "error.update.checkNoRelease":
    "Для этой платформы не найдено опубликованных обновлений. OpenBot сам повторит попытку через несколько минут.",
  "error.update.managedByNix": "Обновления этой копии OpenBot устанавливает Nix. Обновите её через Nix.",
  "error.update.managedByHost":
    "Обновления на этом Mac устанавливает хост. Обновление остаётся готовым до начала обслуживания хоста.",
  "error.update.siblingSession":
    "Из этого приложения всё ещё запущена другая сессия OpenBot. Сначала закройте OpenBot во всех других учётных записях macOS, затем установите обновление снова.",
  "error.update.siblingSessionSameAccount":
    "В этой учётной записи всё ещё работает другой процесс OpenBot. Завершите его, затем установите обновление снова.",
  "error.update.siblingCheckFailed": "Не удалось проверить другие сессии OpenBot. Повторите попытку перед установкой.",
  "error.update.readOnlyLocation":
    "OpenBot не может устанавливать обновления из этого места. Закройте OpenBot. В Finder перетащите OpenBot в папку «Программы» (если он уже там, перетащите его наружу и обратно). Затем откройте OpenBot и установите обновление снова.",
  "error.update.appImageMissing":
    "OpenBot не может установить обновление, потому что его файл AppImage был перемещён, переименован или заменён. Закройте OpenBot, затем снова откройте файл AppImage.",
  "error.update.appImageReadOnly":
    "OpenBot не может устанавливать обновления в папку своего файла AppImage. Закройте OpenBot, переместите файл AppImage в папку внутри домашней папки, затем откройте его и снова установите обновление.",
  "error.update.remoteDisabled": "Обновления от администраторов сервера отключены на этом компьютере.",
  "error.update.restartStarted": "OpenBot уже перезапускается для установки обновления.",
  "error.update.alreadyRestarting": "OpenBot уже перезапускается.",
} as const satisfies PartialTranslation<typeof source>;
