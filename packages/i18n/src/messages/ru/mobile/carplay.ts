import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/carplay";

export const messages = {
  "mobile.carplay.title": "OpenBot",
  "mobile.carplay.pinned": "Закреплённые",
  "mobile.carplay.new": "Новое",
  "mobile.carplay.agents": "Агенты",
  "mobile.carplay.noAgents": "Агентов пока нет",
  "mobile.carplay.locked": "Разблокируйте OpenBot на iPhone",
  "mobile.carplay.signedOut": "Войдите в OpenBot на iPhone",
  "mobile.carplay.voice.listening": "Слушаю…",
  "mobile.carplay.voice.muted": "Микрофон выключен",
  "mobile.carplay.voice.thinking": "{name} думает",
  "mobile.carplay.voice.offline": "Сервер не в сети",
  "mobile.carplay.voice.unavailable": "Настройте голос на iPhone",
} as const satisfies PartialTranslation<typeof source>;
