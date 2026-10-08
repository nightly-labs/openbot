import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.assetsUnavailable":
    "Los recursos de transcripción de voz local no están disponibles. Ejecuta `bun run voice:prepare` y reinicia OpenBot.",
  "error.voice.downloadFailed": "No se pudo descargar el modelo de voz. Inténtalo de nuevo.",
  "error.voice.downloadStopped": "Se detuvo la descarga del modelo de voz.",
  "error.voice.runtimeUnavailable": "La transcripción de voz local no está disponible en esta plataforma.",
  "error.voice.busy": "Ya hay una transcripción de voz en curso.",
  "error.voice.modelUnavailable": "El modelo de voz no está disponible.",
  "error.voice.transcriptionTimedOut": "Se agotó el tiempo de la transcripción de voz.",
  "error.voice.prepareRequired":
    "La transcripción de voz local no está disponible. Ejecuta `bun run voice:prepare` y reinicia OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot no pudo transcribir esta grabación.",
} as const satisfies PartialTranslation<typeof source>;
