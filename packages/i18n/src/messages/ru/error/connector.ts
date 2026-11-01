import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "В этой сборке OpenBot нет GitHub App.",
  "error.connector.githubDenied": "Вход через GitHub отклонён.",
  "error.connector.githubCodeExpired": "Срок действия кода GitHub истёк. Подключите GitHub заново.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App не разрешает вход с устройства.",
  "error.connector.githubClientUnknown": "GitHub не знает Client ID этого GitHub App.",
  "error.connector.githubUnexpected": "GitHub прислал неожиданный ответ: {detail}",
  "error.connector.githubUnreachable": "OpenBot не может связаться с GitHub: {detail}",
  "error.connector.githubExpired": "Подключение к GitHub истекло. Подключите GitHub заново.",
  "error.connector.githubFileUnreadable": "Файл подключения GitHub не читается.",
  "error.connector.githubFileTooLarge": "Файл подключения GitHub слишком большой.",
  "error.connector.onePasswordCliMissing":
    "OpenBot не находит CLI 1Password. Установите его и включите интеграцию в приложении 1Password либо используйте токен сервисного аккаунта.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot не смог установить CLI 1Password. Проверьте подключение к интернету и повторите попытку.",
  "error.connector.onePasswordCliSignedOut":
    "В CLI 1Password не выполнен вход. Включите его интеграцию в приложении 1Password и подключитесь снова.",
  "error.connector.onePasswordCliFailed": "CLI 1Password завершился с ошибкой: {detail}",
  "error.connector.onePasswordUnexpected": "1Password прислал неожиданный ответ: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password не принял токен сервисного аккаунта.",
  "error.connector.onePasswordNoVault":
    "Сервисный аккаунт не может читать ни одно хранилище. Дайте ему доступ к хранилищу и повторите попытку.",
  "error.connector.onePasswordFileUnreadable": "Файл подключения 1Password не читается.",
  "error.connector.onePasswordFileTooLarge": "Файл подключения 1Password слишком большой.",
  "error.connector.bitwardenFailed":
    "Не удалось прочитать Bitwarden. Установите CLI bw, войдите, разблокируйте его и создайте одну папку с именем Shared with OpenBot. Подключитесь с новым ключом сессии.",
  "error.connector.bitwardenHostInput":
    "Введите адрес сервера HTTPS, client_id и client_secret ключа API и мастер-пароль.",
  "error.connector.bitwardenHostFailed":
    "Не удалось открыть Bitwarden на этом сервере. Проверьте адрес сервера, ключ API и мастер-пароль и убедитесь, что одна папка называется Shared with OpenBot. Затем подключитесь снова.",
  "error.connector.bitwardenCliInstallFailed":
    "Не удалось установить Bitwarden CLI на этом сервере. Проверьте его сетевое подключение и подключитесь снова.",
  "error.connector.bitwardenFileUnreadable": "Файл подключения Bitwarden не читается.",
  "error.connector.telegramAccountCredentialsMissing":
    "Введите api_id и api_hash вашего приложения Telegram. Их можно получить на my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "api_id — это число, а api_hash состоит из 32 символов 0-9 и a-f. Скопируйте их снова с my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram не принимает эти api_id и api_hash. Скопируйте их снова с my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat": "Введите номер телефона с кодом страны, например +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid": "Telegram не знает этот номер. Укажите код страны, например +48.",
  "error.connector.telegramAccountCodeInvalid": "Этот код неверный. Проверьте его и попробуйте снова.",
  "error.connector.telegramAccountCodeEmpty": "Введите код, который прислал Telegram.",
  "error.connector.telegramAccountCodeExpired": "Срок действия кода истёк. Начните заново, чтобы получить новый код.",
  "error.connector.telegramAccountPasswordInvalid": "Этот пароль неверный. Попробуйте снова.",
  "error.connector.telegramAccountPasswordEmpty": "Введите пароль двухэтапной аутентификации.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram нужен пароль двухэтапной аутентификации.",
  "error.connector.telegramAccountNoAccount":
    "У этого номера нет аккаунта Telegram. Войдите с номером, который уже использует Telegram.",
  "error.connector.telegramAccountPhoneBanned": "Telegram заблокировал этот номер.",
  "error.connector.telegramAccountQrExpired": "Срок действия QR-кода истёк до сканирования. Начните заново.",
  "error.connector.telegramAccountFloodWait": "Telegram просит подождать. Попробуйте снова через {count} мин.",
  "error.connector.telegramAccountCancelled": "Вход в Telegram отменён.",
  "error.connector.telegramAccountTimedOut": "Вход остановлен после 10 минут без действий. Начните заново.",
  "error.connector.telegramAccountMovedOn": "Вход перешёл к другому шагу. Начните заново.",
  "error.connector.telegramAccountRefused": "Telegram отклонил вход: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot не удалось сохранить подключение Telegram: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram завершил этот сеанс, например в Настройки > Устройства. Подключите аккаунт Telegram заново.",
  "error.connector.telegramAccountFileUnreadable": "Файл подключения аккаунта Telegram не читается.",
  "error.connector.telegramAccountFileTooLarge": "Файл подключения аккаунта Telegram слишком большой.",
  "error.connector.whatsappAccountPhoneFormat": "Введите номер телефона с кодом страны, например +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp не выдал код: {detail}",
  "error.connector.whatsappAccountQrExpired":
    "Срок действия кода истёк до того, как вы его использовали. Начните заново.",
  "error.connector.whatsappAccountTimedOut": "Привязка остановлена после 10 минут без действий. Начните заново.",
  "error.connector.whatsappAccountMovedOn": "Привязка перешла к другому шагу. Начните заново.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp не привязал это устройство: {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot не удалось сохранить подключение WhatsApp: {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp удалил это устройство, например в Настройки > Связанные устройства. Привяжите аккаунт WhatsApp заново.",
  "error.connector.whatsappAccountReplaced":
    "Другая программа открыла это связанное устройство, поэтому WhatsApp закрыл подключение здесь. Отвяжите его, затем привяжите снова.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp отклонил это устройство. Ваш номер может быть ограничен. Проверьте WhatsApp на телефоне.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp больше не принимает эту версию подключения. Обновите OpenBot, затем привяжите устройство снова.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp сейчас недоступен. OpenBot пробует снова. Агенты по-прежнему могут читать чаты на этом компьютере.",
  "error.connector.whatsappAccountFileUnreadable": "Файл подключения аккаунта WhatsApp не читается.",
} as const satisfies PartialTranslation<typeof source>;
