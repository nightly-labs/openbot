import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Этот OpenBot зарегистрирован для доступа через WebRTC.",
  "status.host.identityUpdated": "Идентификатор сервера обновлён.",
  "status.host.starting": "Запуск хоста WebRTC…",
  "status.host.ready": "Этот OpenBot готов к подключениям WebRTC.",
  "status.host.stopping": "Делаю этот OpenBot приватным…",
  "status.host.private": "Этот OpenBot приватный.",
} as const satisfies PartialTranslation<typeof source>;
