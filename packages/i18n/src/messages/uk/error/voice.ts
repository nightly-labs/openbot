import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Не вдалося завантажити голосову модель. Спробуйте ще раз.",
  "error.voice.downloadStopped": "Завантаження голосової моделі зупинено.",
  "error.voice.removeBusy": "Дочекайтеся завершення розпізнавання голосу, потім видаліть модель.",
  "error.voice.removeFailed": "Не вдалося видалити голосову модель. Спробуйте ще раз.",
  "error.voice.runtimeUnavailable": "Локальне розпізнавання голосу недоступне на цій платформі.",
  "error.voice.busy": "Розпізнавання голосу вже триває.",
  "error.voice.modelUnavailable": "Голосова модель недоступна.",
  "error.voice.transcriptionTimedOut": "Час розпізнавання голосу вичерпано.",
  "error.voice.prepareRequired":
    "Локальне розпізнавання голосу недоступне. Виконайте `bun run voice:prepare` і перезапустіть OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot не вдалося розпізнати цей запис.",
  "error.voice.cloud.keyRequired": "Додайте API-ключ ElevenLabs у розділі «Налаштування» → «Голос».",
  "error.voice.cloud.keyRejected": "ElevenLabs не прийняв API-ключ. Перевірте ключ у розділі «Налаштування» → «Голос».",
  "error.voice.cloud.quotaExceeded": "Квоту ElevenLabs вичерпано.",
  "error.voice.cloud.rateLimited": "ElevenLabs перевантажений. Спробуйте ще раз трохи згодом.",
  "error.voice.cloud.termsRequired":
    "Прийміть умови ElevenLabs у своєму обліковому записі ElevenLabs і спробуйте ще раз.",
  "error.voice.cloud.streamEnded": "Потік диктування завершився. Запишіть ще раз.",
  "error.voice.cloud.tooLong": "Запис задовгий.",
  "error.voice.cloud.keySaveFailed": "Не вдалося зберегти API-ключ ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "Локальний синтез мовлення недоступний на цій платформі.",
  "error.voice.speech.modelRequired": "Завантажте модель синтезу мовлення в розділі «Налаштування» → «Голос».",
  "error.voice.speech.timedOut": "Час читання відповіді вголос вичерпано.",
  "error.voice.speech.failed": "OpenBot не вдалося прочитати відповідь уголос.",
  "error.voice.recordingNotKept": "OpenBot не вдалося зберегти голосовий запис.",
} as const satisfies PartialTranslation<typeof source>;
