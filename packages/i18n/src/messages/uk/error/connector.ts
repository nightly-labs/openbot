import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "У цій збірці OpenBot немає GitHub App.",
  "error.connector.githubDenied": "Вхід через GitHub відхилено.",
  "error.connector.githubCodeExpired": "Термін дії коду GitHub минув. Під’єднайте GitHub знову.",
  "error.connector.githubDeviceFlowDisabled": "GitHub App не дозволяє вхід із пристрою.",
  "error.connector.githubClientUnknown": "GitHub не знає Client ID цього GitHub App.",
  "error.connector.githubUnexpected": "GitHub надіслав неочікувану відповідь: {detail}",
  "error.connector.githubUnreachable": "OpenBot не може зв’язатися з GitHub: {detail}",
  "error.connector.githubExpired": "Термін дії під’єднання до GitHub минув. Під’єднайте GitHub знову.",
  "error.connector.githubFileUnreadable": "Файл під’єднання GitHub не вдається прочитати.",
  "error.connector.githubFileTooLarge": "Файл під’єднання GitHub завеликий.",
  "error.connector.onePasswordCliMissing":
    "OpenBot не може знайти CLI 1Password. Установіть його й увімкніть інтеграцію в застосунку 1Password або скористайтеся токеном сервісного облікового запису.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot не вдалося встановити CLI 1Password. Перевірте з’єднання з інтернетом і спробуйте ще раз.",
  "error.connector.onePasswordCliSignedOut":
    "У CLI 1Password не виконано вхід. Увімкніть його інтеграцію в застосунку 1Password і під’єднайтеся знову.",
  "error.connector.onePasswordCliFailed": "Помилка CLI 1Password: {detail}",
  "error.connector.onePasswordUnexpected": "1Password надіслав неочікувану відповідь: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password не прийняв токен сервісного облікового запису.",
  "error.connector.onePasswordNoVault":
    "Сервісний обліковий запис не може читати жодне сховище. Надайте йому доступ до сховища і спробуйте ще раз.",
  "error.connector.onePasswordFileUnreadable": "Файл під’єднання 1Password не вдається прочитати.",
  "error.connector.onePasswordFileTooLarge": "Файл під’єднання 1Password завеликий.",
  "error.connector.bitwardenFailed":
    "Не вдалося прочитати Bitwarden. Установіть CLI bw, увійдіть, розблокуйте його та створіть одну папку з назвою Shared with OpenBot. Під’єднайтеся з новим ключем сеансу.",
  "error.connector.bitwardenHostInput":
    "Введіть адресу сервера HTTPS, client_id і client_secret ключа API та головний пароль.",
  "error.connector.bitwardenHostFailed":
    "Не вдалося відкрити Bitwarden на цьому сервері. Перевірте адресу сервера, ключ API і головний пароль та переконайтеся, що одна папка має назву Shared with OpenBot. Потім під’єднайтеся знову.",
  "error.connector.bitwardenCliInstallFailed":
    "Не вдалося встановити Bitwarden CLI на цьому сервері. Перевірте його мережеве з’єднання і під’єднайтеся знову.",
  "error.connector.bitwardenFileUnreadable": "Файл під’єднання Bitwarden не вдається прочитати.",
} as const satisfies PartialTranslation<typeof source>;
