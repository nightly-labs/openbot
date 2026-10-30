import { defineMessages } from "../../../message";

export const messages = defineMessages("error.voice", {
  // Voice transcription errors.
  "error.voice.downloadFailed": "Could not download the voice model. Try again.",
  "error.voice.downloadStopped": "Voice model download was stopped.",
  "error.voice.removeBusy": "Wait until the voice transcription ends, then remove the model.",
  "error.voice.removeFailed": "Could not remove the voice model. Try again.",
  "error.voice.runtimeUnavailable": "Local voice transcription is not available on this platform.",
  "error.voice.busy": "A voice transcription is already in progress.",
  "error.voice.modelUnavailable": "The voice model is unavailable.",
  "error.voice.transcriptionTimedOut": "Voice transcription timed out.",
  "error.voice.prepareRequired":
    "Local voice transcription is unavailable. Run `bun run voice:prepare` and restart OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot could not transcribe this recording.",
  "error.voice.cloud.keyRequired": "Add your ElevenLabs API key in Settings → Voice.",
  "error.voice.cloud.keyRejected": "ElevenLabs did not accept the API key. Check the key in Settings → Voice.",
  "error.voice.cloud.quotaExceeded": "Your ElevenLabs quota is used up.",
  "error.voice.cloud.rateLimited": "ElevenLabs is busy. Try again in a moment.",
  "error.voice.cloud.termsRequired": "Accept the ElevenLabs terms in your ElevenLabs account, then try again.",
  "error.voice.cloud.streamEnded": "The dictation stream ended. Record again.",
  "error.voice.cloud.tooLong": "The recording is too long.",
  "error.voice.cloud.keySaveFailed": "Could not save the ElevenLabs API key.",
  "error.voice.speech.runtimeUnavailable": "Local speech is not available on this platform.",
  "error.voice.speech.modelRequired": "Download the speech model in Settings → Voice.",
  "error.voice.speech.timedOut": "Reading the reply aloud timed out.",
  "error.voice.speech.failed": "OpenBot could not read the reply aloud.",
  "error.voice.recordingNotKept": "OpenBot could not keep the voice recording.",
  // The user's own voice server.
  "error.voice.server.routeOff": "The voice server is not set up for this. Check Settings → Voice.",
  "error.voice.server.keyRefused": "{host} refused the API key.",
  "error.voice.server.invalidAnswer": "{host} did not send an OpenAI-compatible answer.",
  "error.voice.server.invalidAudio": "{host} sent audio that OpenBot cannot play. Use a server that sends WAV.",
  "error.voice.server.tooLarge": "The answer from {host} is too large.",
});
