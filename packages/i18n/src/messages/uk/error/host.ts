import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/host";

export const messages = {
  "error.host.iceServersMissing": "Remote Signal не надав ICE-сервери.",
  "error.host.keyRotationUnavailable": "Цей сервер не може змінити ключ без служби облікових записів.",
  "error.host.keyRotationRefused":
    "Служба облікових записів не прийняла новий ключ сервера. Поточний ключ і далі використовується.",
  "error.host.webRtcNotConfigured": "Службу хоста WebRTC не налаштовано.",
  "error.host.runtimeNotInstalled": "Середовище віддаленого робочого стола не встановлено.",
  "error.host.setupUnavailable": "Налаштування дозволів недоступне.",
  "error.host.accountChangedDuringUpdate":
    "Обліковий запис, у який виконано вхід, змінився під час оновлення цього сервера.",
  "error.host.nameBeforePublish": "Дайте цьому OpenBot назву, перш ніж публікувати його.",
  "error.host.memberNotFound": "Віддаленого учасника не існує.",
  "error.host.publishBeforeInvite": "Зробіть цей OpenBot публічним, перш ніж створювати запрошення.",
  "error.host.teamAccessUnavailable": "Не вдається скористатися вашим доступом до команди.",
  "error.host.ownerIdentityUnavailable": "Ідентифікатор власника хоста недоступний.",
  "error.host.reserveAddressFailed": "Не вдалося зарезервувати публічну адресу.",
  "error.host.publishFailed": "Не вдалося опублікувати цей OpenBot.",
  "error.host.mobileConnectPublishFailed": "Не вдалося опублікувати цей OpenBot для Mobile Connect.",
  "error.host.mobileConnectHostChanged": "Хост Mobile Connect змінився. Спробуйте ще раз.",
  "error.host.noServer": "На цьому комп’ютері немає сервера, який можна змінити.",
  "error.host.identityLocalOnly": "Назву й логотип сервера можна змінити лише на комп’ютері, де він працює.",
  "error.host.timezoneInvalid": "Цей часовий пояс невідомий.",
  "error.host.maintenanceInterrupted":
    "Обслуговування хоста перервано. Перевірте застосунок і скиньте стан хоста, перш ніж повторювати.",
  "error.host.updateFailed":
    "Оновлення хоста не вдалося на етапі {phase}. Перевірте власника пакета, підпис, стан тенантів і вільне місце на диску, перш ніж скидати стан.",
  "error.host.tenantsNotIdle": "Тенанти не простоювали п’ять хвилин поспіль протягом двох годин.",
  "error.host.tenantShutdownTimeout": "Час зупинки тенантів вичерпано. Заміну застосунку не розпочато.",
  "error.host.tenantHealthMissing":
    "Після перезапуску звіти про стан тенантів відсутні або показують збій. Перевірте сеанси тенантів перед наступним оновленням.",
} as const satisfies PartialTranslation<typeof source>;
