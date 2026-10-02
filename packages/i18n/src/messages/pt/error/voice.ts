import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.assetsUnavailable":
    "Os arquivos de transcrição de voz local estão indisponíveis. Execute `bun run voice:prepare` e reinicie o OpenBot.",
  "error.voice.downloadFailed": "Não foi possível baixar o modelo de voz. Tente novamente.",
  "error.voice.downloadStopped": "O download do modelo de voz foi interrompido.",
  "error.voice.runtimeUnavailable": "A transcrição de voz local não está disponível nesta plataforma.",
  "error.voice.busy": "Uma transcrição de voz já está em andamento.",
  "error.voice.modelUnavailable": "O modelo de voz está indisponível.",
  "error.voice.transcriptionTimedOut": "O tempo para transcrever a voz esgotou.",
  "error.voice.prepareRequired":
    "A transcrição de voz local está indisponível. Execute `bun run voice:prepare` e reinicie o OpenBot.",
  "error.voice.transcriptionFailed": "O OpenBot não conseguiu transcrever esta gravação.",
} as const satisfies PartialTranslation<typeof source>;
