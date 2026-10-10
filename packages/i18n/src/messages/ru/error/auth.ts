import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/auth";

export const messages = {
  "error.auth.serviceUnavailable":
    "OpenBot не смог связаться со службой аккаунтов. Убедитесь, что API работает, и повторите попытку.",
  "error.auth.networkBlocked":
    "Брандмауэр или прокси в этой сети не дал OpenBot подключиться к {host}. Попросите сетевого администратора разрешить {host} и повторите попытку.",
  "error.auth.signInFirst": "Сначала войдите в OpenBot.",
  "error.auth.signInRequired": "Требуется вход.",
  "error.auth.accountChangedDuringRegister":
    "Аккаунт, в который выполнен вход, изменился во время регистрации этого сервера.",
  "error.auth.hostCredentialUnavailable": "Учётные данные удалённого хоста недоступны. Зарегистрируйте хост заново.",
  "error.auth.codeNotVerified": "Не удалось проверить код входа.",
  "error.auth.serviceError": "Служба аккаунтов вернула ошибку.",
  "error.auth.serviceUnreachable":
    "OpenBot не смог связаться со службой аккаунтов. Проверьте подключение и повторите попытку.",
  "error.auth.serviceTimeout": "Служба аккаунтов не ответила вовремя. Повторите попытку.",
  "error.auth.serviceStatus": "Служба аккаунтов вернула ошибку ({status}). Повторите попытку позже.",
  "error.auth.invalidHostedServer": "Служба аккаунтов вернула некорректный облачный сервер.",
  "error.auth.codeNotSent": "OpenBot не смог отправить код входа.",
  "error.auth.deliveryTimeout":
    "OpenBot не успел подтвердить доставку. Код всё же может прийти; проверьте доставку, прежде чем отправлять снова.",
  "error.auth.deliveryInterrupted":
    "Соединение оборвалось, прежде чем OpenBot подтвердил доставку. Проверьте доставку, чтобы не отправлять код повторно.",
  "error.auth.deliveryUnknown":
    "OpenBot не смог подтвердить, отправлен ли код входа. Проверьте доставку, прежде чем отправлять снова.",
} as const satisfies PartialTranslation<typeof source>;
