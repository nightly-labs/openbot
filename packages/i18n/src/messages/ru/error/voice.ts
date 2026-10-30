import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Не удалось загрузить голосовую модель. Повторите попытку.",
  "error.voice.downloadStopped": "Загрузка голосовой модели остановлена.",
  "error.voice.removeBusy": "Дождитесь окончания расшифровки голоса, затем удалите модель.",
  "error.voice.removeFailed": "Не удалось удалить голосовую модель. Повторите попытку.",
  "error.voice.runtimeUnavailable": "Локальная расшифровка голоса недоступна на этой платформе.",
  "error.voice.busy": "Расшифровка голоса уже выполняется.",
  "error.voice.modelUnavailable": "Голосовая модель недоступна.",
  "error.voice.transcriptionTimedOut": "Время расшифровки голоса истекло.",
  "error.voice.prepareRequired":
    "Локальная расшифровка голоса недоступна. Выполните `bun run voice:prepare` и перезапустите OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot не смог расшифровать эту запись.",
  "error.voice.cloud.keyRequired": "Добавьте API-ключ ElevenLabs в разделе «Настройки» → «Голос».",
  "error.voice.cloud.keyRejected": "ElevenLabs не принял API-ключ. Проверьте ключ в разделе «Настройки» → «Голос».",
  "error.voice.cloud.quotaExceeded": "Квота ElevenLabs исчерпана.",
  "error.voice.cloud.rateLimited": "ElevenLabs перегружен. Повторите попытку чуть позже.",
  "error.voice.cloud.termsRequired": "Примите условия ElevenLabs в своём аккаунте ElevenLabs и повторите попытку.",
  "error.voice.cloud.streamEnded": "Передача диктовки прервалась. Запишите ещё раз.",
  "error.voice.cloud.tooLong": "Запись слишком длинная.",
  "error.voice.cloud.keySaveFailed": "Не удалось сохранить API-ключ ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "Локальный синтез речи недоступен на этой платформе.",
  "error.voice.speech.modelRequired": "Скачайте модель синтеза речи в разделе «Настройки» → «Голос».",
  "error.voice.speech.timedOut": "Время чтения ответа вслух истекло.",
  "error.voice.speech.failed": "OpenBot не смог прочитать ответ вслух.",
  "error.voice.recordingNotKept": "OpenBot не смог сохранить голосовую запись.",
} as const satisfies PartialTranslation<typeof source>;
