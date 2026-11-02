import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.downloadFailed": "음성 모델을 다운로드할 수 없어요. 다시 시도해 주세요.",
  "error.voice.downloadStopped": "음성 모델 다운로드가 중지되었어요.",
  "error.voice.removeBusy": "음성 받아쓰기가 끝날 때까지 기다린 후 모델을 삭제해 주세요.",
  "error.voice.removeFailed": "음성 모델을 삭제할 수 없어요. 다시 시도해 주세요.",
  "error.voice.runtimeUnavailable": "이 플랫폼에서는 로컬 음성 받아쓰기를 사용할 수 없어요.",
  "error.voice.busy": "음성 받아쓰기가 이미 진행 중이에요.",
  "error.voice.modelUnavailable": "음성 모델을 사용할 수 없어요.",
  "error.voice.transcriptionTimedOut": "음성 받아쓰기 시간이 초과되었어요.",
  "error.voice.prepareRequired":
    "로컬 음성 받아쓰기를 사용할 수 없어요. `bun run voice:prepare`를 실행한 후 OpenBot을 다시 시작해 주세요.",
  "error.voice.transcriptionFailed": "OpenBot이 이 녹음을 받아쓰지 못했어요.",
  "error.voice.cloud.keyRequired": "설정 → 음성에서 ElevenLabs API 키를 추가해 주세요.",
  "error.voice.cloud.keyRejected": "ElevenLabs가 API 키를 받아들이지 않았어요. 설정 → 음성에서 키를 확인해 주세요.",
  "error.voice.cloud.quotaExceeded": "ElevenLabs 사용량을 모두 소진했어요.",
  "error.voice.cloud.rateLimited": "ElevenLabs가 바빠요. 잠시 후 다시 시도해 주세요.",
  "error.voice.cloud.termsRequired": "ElevenLabs 계정에서 약관에 동의한 후 다시 시도해 주세요.",
  "error.voice.cloud.streamEnded": "받아쓰기 스트림이 종료되었어요. 다시 녹음해 주세요.",
  "error.voice.cloud.tooLong": "녹음이 너무 길어요.",
  "error.voice.cloud.keySaveFailed": "ElevenLabs API 키를 저장할 수 없어요.",
  "error.voice.speech.runtimeUnavailable": "이 플랫폼에서는 로컬 음성 읽기를 사용할 수 없어요.",
  "error.voice.speech.modelRequired": "설정 → 음성에서 음성 읽기 모델을 다운로드해 주세요.",
  "error.voice.speech.timedOut": "답변을 소리 내어 읽는 시간이 초과되었어요.",
  "error.voice.speech.failed": "OpenBot이 답변을 소리 내어 읽지 못했어요.",
  "error.voice.recordingNotKept": "OpenBot이 음성 녹음을 보관하지 못했어요.",
} as const satisfies PartialTranslation<typeof source>;
