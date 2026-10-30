import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "Não foi possível baixar o modelo de voz. Tente novamente.",
  "error.voice.downloadStopped": "O download do modelo de voz foi interrompido.",
  "error.voice.removeBusy": "Aguarde o fim da transcrição de voz e depois remova o modelo.",
  "error.voice.removeFailed": "Não foi possível remover o modelo de voz. Tente novamente.",
  "error.voice.runtimeUnavailable": "A transcrição de voz local não está disponível nesta plataforma.",
  "error.voice.busy": "Uma transcrição de voz já está em andamento.",
  "error.voice.modelUnavailable": "O modelo de voz está indisponível.",
  "error.voice.transcriptionTimedOut": "O tempo para transcrever a voz esgotou.",
  "error.voice.prepareRequired":
    "A transcrição de voz local está indisponível. Execute `bun run voice:prepare` e reinicie o OpenBot.",
  "error.voice.transcriptionFailed": "O OpenBot não conseguiu transcrever esta gravação.",
  "error.voice.cloud.keyRequired": "Adicione sua chave de API da ElevenLabs em Configurações → Voz.",
  "error.voice.cloud.keyRejected": "A ElevenLabs não aceitou a chave de API. Confira a chave em Configurações → Voz.",
  "error.voice.cloud.quotaExceeded": "Sua cota da ElevenLabs acabou.",
  "error.voice.cloud.rateLimited": "A ElevenLabs está ocupada. Tente novamente em instantes.",
  "error.voice.cloud.termsRequired": "Aceite os termos da ElevenLabs na sua conta da ElevenLabs e tente novamente.",
  "error.voice.cloud.streamEnded": "A transmissão do ditado terminou. Grave de novo.",
  "error.voice.cloud.tooLong": "A gravação é longa demais.",
  "error.voice.cloud.keySaveFailed": "Não foi possível salvar a chave de API da ElevenLabs.",
  "error.voice.speech.runtimeUnavailable": "A voz local não está disponível nesta plataforma.",
  "error.voice.speech.modelRequired": "Baixe o modelo de voz em Configurações → Voz.",
  "error.voice.speech.timedOut": "A leitura da resposta em voz alta expirou.",
  "error.voice.speech.failed": "O OpenBot não conseguiu ler a resposta em voz alta.",
  "error.voice.recordingNotKept": "O OpenBot não conseguiu guardar a gravação de voz.",
} as const satisfies PartialTranslation<typeof source>;
