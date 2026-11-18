import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Этот сервер не поддерживает CRM. Обновите OpenBot на компьютере, на котором он работает.",
  "error.crm.tooLargeToSend": "Эта страница CRM слишком велика для отправки в это приложение.",
  "error.crm.customerMissing": "Этого клиента больше нет.",
  "error.crm.planMissing": "Этого тарифа больше нет.",
  "error.crm.paymentMissing": "Этого платежа больше нет.",
  "error.crm.tagMissing": "Этого тега больше нет.",
  "error.crm.statusMissing": "Этого статуса больше нет.",
  "error.crm.proposalMissing": "Этого предложения больше нет, или по нему уже принято решение.",
  "error.crm.tagExists": "Тег с таким названием уже существует.",
  "error.crm.statusExists": "Статус с таким названием уже существует.",
  "error.crm.builtinStatus": "Встроенный статус нельзя переименовать или удалить.",
  "error.crm.tooManyStatuses": "В CRM уже максимальное число статусов. Сначала удалите статус.",
  "error.crm.tooManyTags": "В CRM уже максимальное число тегов. Сначала удалите тег.",
  "error.crm.tooManyPlans": "У этого клиента уже максимальное число тарифов. Сначала удалите тариф.",
  "error.crm.paymentPaid": "Этот платёж отмечен как оплаченный. Сначала отметьте его как неоплаченный.",
  "error.crm.splitTotal": "Сумма частей должна быть равна сумме платежа.",
  "error.crm.planEndsBeforeStart": "Тариф не может закончиться раньше, чем начнётся.",
  "error.crm.currencyInUse": "Нельзя изменить валюту клиента, у которого есть тарифы или платежи.",
  "error.crm.badCursor": "Эта страница больше не действительна. Загрузите список заново.",
  "error.crm.invalidChange": "Это изменение недопустимо.",
  "error.crm.agentNotAllowed":
    "Этот агент не может работать с CRM. Владелец или администратор может дать ему доступ: откройте страницу CRM, нажмите «Предложения», нажмите кнопку с числом агентов и включите этого агента.",
  "error.crm.tooManyProposals": "Слишком много предложений ждут решения. Подождите, пока человек их рассмотрит.",
  "error.crm.amountInvalid": "Введите сумму числом, например 129.00.",
  "error.crm.amountDecimals": "В сумме слишком много знаков после запятой для {currency}.",
  "error.crm.fieldPrivate": "Это поле скрыто. Агенты не могут читать его или фильтровать по нему.",
  "error.crm.sourceOwned":
    "Stripe управляет этой строкой. Измените её в Stripe; CRM получит изменение при следующей синхронизации.",
  "error.crm.sourceConnected": "Stripe уже подключён к этой CRM.",
  "error.crm.sourceMissing": "Этого подключения к Stripe больше нет.",
  "error.crm.sourceSecretKey":
    "Это секретный ключ, он может изменять ваш аккаунт Stripe. Создайте ограниченный ключ только с доступом на чтение.",
  "error.crm.sourceInvalidKey": "Stripe не принимает этот ключ. Скопируйте ограниченный ключ ещё раз.",
  "error.crm.sourcePermission":
    "Этот ключ не может читать клиентов, счета, подписки, события и продукты. Дайте ему доступ на чтение к ним.",
  "error.crm.sourceRateLimited": "Stripe получил слишком много запросов. Повторите попытку через минуту.",
  "error.crm.sourceNetwork": "OpenBot не может подключиться к Stripe. Проверьте подключение к интернету.",
  "error.crm.sourceFailed": "Stripe прислал ответ, который OpenBot не может прочитать. Повторите попытку позже.",
  "error.crm.sourceKeySaveFailed": "OpenBot не может сохранить ключ Stripe на этом компьютере.",
  "error.crm.off":
    "CRM выключена. Владелец или администратор может включить её в разделе «Настройки сервера > Экспериментальные».",
  "error.crm.settingsSaveFailed": "OpenBot не может сохранить настройку CRM на этом сервере.",
} as const satisfies PartialTranslation<typeof source>;
