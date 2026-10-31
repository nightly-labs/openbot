import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Цей OpenBot зареєстровано для доступу через WebRTC.",
  "status.host.keyRotated": "Ключ сервера змінено. Пов’язані пристрої залишаються пов’язаними.",
  "status.host.identityUpdated": "Ідентифікаційні дані сервера оновлено.",
  "status.host.starting": "Запуск хоста WebRTC…",
  "status.host.ready": "Цей OpenBot готовий до під’єднань WebRTC.",
  "status.host.stopping": "Переведення цього OpenBot у приватний режим…",
  "status.host.private": "Цей OpenBot приватний.",
} as const satisfies PartialTranslation<typeof source>;
