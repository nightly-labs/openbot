import { defineMessages } from "../../../message";

export const messages = defineMessages("error.voice", {
  // Voice transcription errors.
  "error.voice.assetsUnavailable":
    "Local voice transcription assets are unavailable. Run `bun run voice:prepare` and restart OpenBot.",
  "error.voice.downloadFailed": "Could not download the voice model. Try again.",
  "error.voice.downloadStopped": "Voice model download was stopped.",
  "error.voice.runtimeUnavailable": "Local voice transcription is not available on this platform.",
  "error.voice.busy": "A voice transcription is already in progress.",
  "error.voice.modelUnavailable": "The voice model is unavailable.",
  "error.voice.transcriptionTimedOut": "Voice transcription timed out.",
  "error.voice.prepareRequired":
    "Local voice transcription is unavailable. Run `bun run voice:prepare` and restart OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot could not transcribe this recording.",
});
