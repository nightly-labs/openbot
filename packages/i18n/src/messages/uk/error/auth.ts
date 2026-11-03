import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot не зміг зв’язатися зі службою облікових записів. Переконайтеся, що API працює, і повторіть спробу.",
  "error.auth.networkBlocked":
    "Брандмауер або проксі в цій мережі не дав OpenBot під’єднатися до {host}. Попросіть адміністратора мережі дозволити {host} і повторіть спробу.",
  "error.auth.signInFirst": "Спершу увійдіть в OpenBot.",
  "error.auth.signInRequired": "Потрібно увійти.",
  "error.auth.accountChangedDuringRegister":
    "Обліковий запис, у який виконано вхід, змінився під час реєстрації цього сервера.",
  "error.auth.hostCredentialUnavailable": "Облікові дані віддаленого хоста недоступні. Зареєструйте хост ще раз.",
  "error.auth.codeNotVerified": "Не вдалося перевірити код входу.",
  "error.auth.serviceError": "Служба облікових записів повернула помилку.",
  "error.auth.serviceUnreachable":
    "OpenBot не зміг зв’язатися зі службою облікових записів. Перевірте з’єднання й повторіть спробу.",
  "error.auth.serviceTimeout": "Служба облікових записів не відповіла вчасно. Повторіть спробу.",
  "error.auth.serviceStatus": "Служба облікових записів повернула помилку ({status}). Повторіть спробу пізніше.",
  "error.auth.invalidHostedServer": "Служба облікових записів повернула некоректний хмарний сервер.",
  "error.auth.codeNotSent": "OpenBot не зміг надіслати код входу.",
  "error.auth.deliveryTimeout":
    "OpenBot не встиг підтвердити доставку. Код усе ж може надійти; перевірте доставку, перш ніж надсилати знову.",
  "error.auth.deliveryInterrupted":
    "З’єднання обірвалося, перш ніж OpenBot підтвердив доставку. Перевірте доставку, щоб не надсилати код повторно.",
  "error.auth.deliveryUnknown":
    "OpenBot не зміг підтвердити, чи надіслано код входу. Перевірте доставку, перш ніж надсилати знову.",
} as const satisfies PartialTranslation<typeof source>;
