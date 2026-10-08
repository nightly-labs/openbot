import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "В этой сборке OpenBot нет приложения GitHub App.",
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
} as const satisfies PartialTranslation<typeof source>;
