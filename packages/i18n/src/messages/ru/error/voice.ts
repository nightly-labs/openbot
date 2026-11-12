import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Не удалось загрузить голосовую модель. Повторите попытку.",
  "error.voice.downloadStopped": "Загрузка голосовой модели остановлена.",
  "error.voice.removeBusy": "Дождитесь окончания расшифровки голоса, затем удалите модель.",
  "error.voice.removeFailed": "Не удалось удалить голосовую модель. Повторите попытку.",
  "error.voice.runtimeUnavailable": "Локальная расшифровка голоса недоступна на этой платформе.",
  "error.voice.modelUnavailable": "Голосовая модель недоступна.",
  "error.voice.transcriptionTimedOut": "Время расшифровки голоса истекло.",
  "error.voice.prepareRequired":
    "Локальная расшифровка голоса недоступна. Выполните `bun run voice:prepare` и перезапустите OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot не смог расшифровать эту запись.",
  "error.voice.cloud.keyRequired": "Добавьте API-ключ {provider} в разделе «Настройки» → «Голос».",
  "error.voice.cloud.keyRejected": "{provider} не принял API-ключ. Проверьте ключ в разделе «Настройки» → «Голос».",
  "error.voice.cloud.quotaExceeded": "Квота {provider} исчерпана.",
  "error.voice.cloud.rateLimited": "{provider} перегружен. Повторите попытку чуть позже.",
  "error.voice.cloud.termsRequired": "Примите условия ElevenLabs в своём аккаунте ElevenLabs и повторите попытку.",
  "error.voice.cloud.streamEnded": "Передача диктовки прервалась. Запишите ещё раз.",
  "error.voice.cloud.tooLong": "Запись слишком длинная.",
  "error.voice.cloud.keySaveFailed": "Не удалось сохранить API-ключ {provider}.",
  "error.voice.speech.runtimeUnavailable": "Локальный синтез речи недоступен на этой платформе.",
  "error.voice.speech.modelRequired": "Скачайте модель синтеза речи в разделе «Настройки» → «Голос».",
  "error.voice.speech.timedOut": "Время чтения ответа вслух истекло.",
  "error.voice.speech.failed": "OpenBot не смог прочитать ответ вслух.",
  "error.voice.recordingNotKept": "OpenBot не смог сохранить голосовую запись.",
  "error.voice.live.timedOut": "Живой голос Codex не запустился вовремя. Попробуйте ещё раз.",
  "error.voice.live.failed": "Живой голос остановлен: {reason}",
  "error.voice.live.disconnected": "Живой голос отключён.",
  "error.voice.live.hostFailed":
    "Codex на сервере не смог запустить живой голос. Попросите владельца обновить Codex на этом компьютере и войти через ChatGPT, затем попробуйте снова.",
  "error.voice.live.signIn": "Войдите в Codex с аккаунтом ChatGPT, чтобы использовать живой голос.",
  "error.voice.live.unavailable":
    "OpenAI не удалось запустить живой голос. Проблема на стороне OpenAI. Повторите попытку позже.",
  "error.voice.live.refused":
    "Запуск живого голоса отклонён на стороне OpenAI. Повторите попытку позже или выключите живой голос в Настройках, чтобы говорить голосом.",
  "error.voice.live.off": "Живой голос Codex выключен. Включите его в Настройки → Голос.",
} as const satisfies PartialTranslation<typeof source>;
