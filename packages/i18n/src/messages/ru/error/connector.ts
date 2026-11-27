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
  "error.connector.githubOffline":
    "OpenBot не может связаться с GitHub. Проверьте подключение к интернету и настройки DNS компьютера или сервера, на котором работает OpenBot, затем повторите попытку.",
  "error.connector.githubExpired": "Подключение к GitHub истекло. Подключите GitHub заново.",
  "error.connector.githubFileUnreadable": "Файл подключения GitHub не читается.",
  "error.connector.githubFileTooLarge": "Файл подключения GitHub слишком большой.",
  "error.connector.nearSignIn": "Войдите в OpenBot, чтобы пользоваться криптокошельком.",
  "error.connector.nearServiceUnavailable": "Сервис криптокошелька недоступен. Попробуйте позже.",
  "error.connector.nearWalletNotFound": "Этот кошелёк не относится к этому аккаунту OpenBot или серверу.",
  "error.connector.nearWalletLimit": "Сегодня создано слишком много новых кошельков. Попробуйте завтра.",
  "error.connector.nearProviderBusy": "NEAR Intents сейчас не отвечает. Попробуйте через несколько минут.",
  "error.connector.nearNoWallet":
    "Криптокошелёк не настроен. Настройте его в разделе «Настройки сервера > Vault > Крипто».",
  "error.connector.nearWalletExists": "Криптокошелёк уже настроен.",
  "error.connector.nearFrozen":
    "Платежи из криптокошелька приостановлены. Возобновите их в разделе «Настройки сервера > Vault > Крипто».",
  "error.connector.nearAgentNotAllowed":
    "Этот агент не может платить из криптокошелька. Разрешите это в разделе «Настройки сервера > Vault > Крипто».",
  "error.connector.nearGrantExpired":
    "У OpenBot нет разрешения на платежи из криптокошелька. Продлите его в разделе «Настройки сервера > Vault > Крипто».",
  "error.connector.nearUnknownAsset": "В криптокошельке нет актива {asset}.",
  "error.connector.nearAmountInvalid": "{amount} — недопустимая сумма {asset}.",
  "error.connector.nearRecipientInvalid": "{recipient} не является аккаунтом NEAR или адресом вида chain:address.",
  "error.connector.nearRefused": "NEAR Intents Agent API отклонил запрос: {detail}",
  "error.connector.nearUnexpected": "NEAR Intents Agent API прислал неожиданный ответ: {detail}",
  "error.connector.nearUnreachable": "OpenBot не может связаться с NEAR Intents Agent API: {detail}",
  "error.connector.nearFileUnreadable": "Не удаётся прочитать файл криптокошелька.",
  "error.connector.nearFileTooLarge": "Файл криптокошелька слишком большой.",
  "error.connector.nearSigningCanceled": "Подпись отменена.",
  "error.connector.nearSigningExpired": "Подпись не пришла вовремя. Попробуйте снова.",
  "error.connector.nearSigningInvalid": "Подпись из браузера недействительна.",
  "error.connector.nearSigningBusy": "В браузере уже ждёт другая подпись. Сначала завершите или отмените её.",
  "error.connector.nearPolicyCooldown": "Правила кошелька можно будет снова изменить с {time}.",
  "error.connector.nearPolicyPending": "Изменение правил не завершилось. Попробуйте через несколько минут.",
  "error.connector.nearDeclined": "Владелец отклонил платёж.",
  "error.connector.nearUncertain":
    "OpenBot не знает, был ли отправлен платёж. Не платите повторно. Владелец может проверить историю кошелька.",
  "error.connector.nearPaymentFailed": "Платёж не удался: {detail}",
  "error.connector.nearPaymentUnknown": "Этот платёж больше не ждёт ответа.",
  "error.connector.nearRuleFull": "В правиле платежей может быть не более {limit} получателей.",
  "error.connector.nearRulesFull": "В кошельке может быть не более {limit} правил платежей.",
  "error.connector.onePasswordCliMissing":
    "OpenBot не находит CLI 1Password. Установите его и включите интеграцию в приложении 1Password либо используйте токен сервисного аккаунта.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot не смог установить CLI 1Password. Проверьте подключение к интернету и повторите попытку.",
  "error.connector.onePasswordCliSignedOut":
    "В CLI 1Password не выполнен вход. Включите его интеграцию в приложении 1Password и подключитесь снова.",
  "error.connector.onePasswordAppUnreachable":
    "OpenBot не может связаться с приложением 1Password. Откройте 1Password и разблокируйте его. В разделе «Настройки» > «Разработчик» проверьте, что параметр «Integrate with 1Password CLI» включён. Затем повторите попытку.",
  "error.connector.onePasswordCliFailed": "CLI 1Password завершился с ошибкой: {detail}",
  "error.connector.onePasswordCliForbidden":
    "Ваш аккаунт 1Password не позволяет вам создать общее хранилище или сервисный аккаунт. Попросите владельца или администратора аккаунта дать это разрешение или выдать токен сервисного аккаунта, затем нажмите «Использовать токен».",
  "error.connector.onePasswordUnexpected": "1Password прислал неожиданный ответ: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password не принял токен сервисного аккаунта.",
  "error.connector.onePasswordUnreachable":
    "OpenBot не смог подключиться к 1Password. Проверьте подключение к интернету и повторите попытку.",
  "error.connector.onePasswordRateLimited":
    "1Password получил слишком много запросов. Подождите несколько минут и повторите попытку.",
  "error.connector.onePasswordNoVault":
    "Сервисный аккаунт не может читать ни одно хранилище. Дайте ему доступ к хранилищу и повторите попытку.",
  "error.connector.onePasswordReadFailed":
    "OpenBot не может прочитать ваши логины в 1Password. Отключите 1Password, затем подключите его снова.",
  "error.connector.onePasswordFileUnreadable": "Файл подключения 1Password не читается.",
  "error.connector.onePasswordFileTooLarge": "Файл подключения 1Password слишком большой.",
  "error.connector.bitwardenFailed":
    "Не удалось прочитать Bitwarden. Установите CLI bw, войдите, разблокируйте его и создайте одну папку с именем Shared with OpenBot. Подключитесь с новым ключом сессии.",
  "error.connector.bitwardenCliMissing":
    "OpenBot не находит Bitwarden CLI. Установите bw, проверьте, что он работает в новом терминале, и подключитесь снова.",
  "error.connector.bitwardenFolderMissing":
    "В Bitwarden должна быть ровно одна папка с именем Shared with OpenBot. Создайте её или удалите лишнюю, затем подключитесь снова.",
  "error.connector.bitwardenHostInput":
    "Введите адрес сервера HTTPS, client_id и client_secret ключа API и мастер-пароль.",
  "error.connector.bitwardenHostFailed":
    "Не удалось открыть Bitwarden на этом сервере. Проверьте адрес сервера, ключ API и мастер-пароль и убедитесь, что одна папка называется Shared with OpenBot. Затем подключитесь снова.",
  "error.connector.bitwardenHostSignInFailed":
    "Не удалось войти в Bitwarden на этом сервере. Проверьте адрес сервера и ключ API, затем подключитесь снова.",
  "error.connector.bitwardenHostUnlockFailed":
    "Не удалось разблокировать Bitwarden на этом сервере. Проверьте мастер-пароль, затем подключитесь снова.",
  "error.connector.bitwardenCliInstallFailed":
    "Не удалось установить Bitwarden CLI на этом сервере. Проверьте его сетевое подключение и подключитесь снова.",
  "error.connector.bitwardenCliCannotStart":
    "Bitwarden CLI не запустился на этом сервере. Подключитесь снова. Если он всё ещё не запускается, выберите Справка > Сообщить о проблеме.",
  "error.connector.bitwardenFileUnreadable": "Файл подключения Bitwarden не читается.",
  "error.connector.passwordManagerUnknown": "OpenBot не знает этот менеджер паролей.",
  "error.connector.passwordManagerMethod": "Этот менеджер паролей нельзя подключить таким способом.",
  "error.connector.passwordManagerNoSignIn": "Страница входа не открыта. Подключитесь снова.",
  "error.connector.protonPassFailed": "Не удалось подключить Proton Pass. Подключитесь снова.",
  "error.connector.protonPassCliInstallFailed":
    "Не удалось установить Proton Pass CLI. Проверьте сетевое подключение и подключитесь снова.",
  "error.connector.protonPassPlan":
    "Ваш тариф Proton не разрешает Proton Pass CLI. Смените тариф и подключитесь снова.",
  "error.connector.protonPassPlanMissing":
    "Ваш тариф Proton не включает Proton Pass CLI. Нужен тариф Proton, который включает Pass Plus. Смените тариф и подключитесь снова.",
  "error.connector.protonPassExpired": "Доступ к Proton Pass закончился. Подключитесь снова.",
  "error.connector.protonPassKeyInvalid": "Введите ключ доступа Proton Pass, который начинается с pst_.",
  "error.connector.protonPassExtraPassword": "Дополнительный пароль неверен. Введите его снова.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass не запрашивал дополнительный пароль.",
  "error.connector.protonPassFileUnreadable": "Не удалось прочитать файл подключения Proton Pass.",
  "error.connector.protonPassSignInTimeout": "Вход в Proton занял слишком много времени. Подключитесь снова.",
  "error.connector.protonPassSetupFailed":
    "Не удалось создать в Proton Pass хранилище Shared with OpenBot или его ключ доступа. Подключитесь снова.",
} as const satisfies PartialTranslation<typeof source>;
