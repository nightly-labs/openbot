import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "No se pudo descargar el modelo de voz. Inténtalo de nuevo.",
  "error.voice.downloadStopped": "Se detuvo la descarga del modelo de voz.",
  "error.voice.removeBusy": "Espera a que termine la transcripción de voz y luego quita el modelo.",
  "error.voice.removeFailed": "No se pudo quitar el modelo de voz. Inténtalo de nuevo.",
  "error.voice.runtimeUnavailable": "La transcripción de voz local no está disponible en esta plataforma.",
  "error.voice.busy": "Ya hay una transcripción de voz en curso.",
  "error.voice.modelUnavailable": "El modelo de voz no está disponible.",
  "error.voice.transcriptionTimedOut": "Se agotó el tiempo de la transcripción de voz.",
  "error.voice.prepareRequired":
    "La transcripción de voz local no está disponible. Ejecuta `bun run voice:prepare` y reinicia OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot no pudo transcribir esta grabación.",
  "error.voice.cloud.keyRequired": "Añade tu clave de API de ElevenLabs en Ajustes → Voz.",
  "error.voice.cloud.keyRejected": "ElevenLabs no aceptó la clave de API. Revisa la clave en Ajustes → Voz.",
  "error.voice.cloud.quotaExceeded": "Tu cuota de ElevenLabs se ha agotado.",
  "error.voice.cloud.rateLimited": "ElevenLabs está ocupado. Inténtalo de nuevo en un momento.",
  "error.voice.cloud.termsRequired":
    "Acepta los términos de ElevenLabs en tu cuenta de ElevenLabs y vuelve a intentarlo.",
  "error.voice.cloud.streamEnded": "La transmisión del dictado terminó. Graba de nuevo.",
  "error.voice.cloud.tooLong": "La grabación es demasiado larga.",
  "error.voice.cloud.keySaveFailed": "No se pudo guardar la clave de API de ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "La voz local no está disponible en esta plataforma.",
  "error.voice.speech.modelRequired": "Descarga el modelo de voz en Ajustes → Voz.",
  "error.voice.speech.timedOut": "Se agotó el tiempo al leer la respuesta en voz alta.",
  "error.voice.speech.failed": "OpenBot no pudo leer la respuesta en voz alta.",
  "error.voice.recordingNotKept": "OpenBot no pudo guardar la grabación de voz.",
} as const satisfies PartialTranslation<typeof source>;
