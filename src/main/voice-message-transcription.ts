import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { isLocalVoiceModelId, VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import type { VoiceTranscriptionService } from "./voice-transcription-service";

const logger = createOpenBotLogger("voice-message-transcription");
const execFileAsync = promisify(execFile);

const DECODE_TIMEOUT_MS = 30_000;
const WAV_DATA_MARKER_OFFSET = 36;
const WAV_HEADER_BYTES = 44;

export type VoiceMessageVoice = Pick<VoiceTranscriptionService, "getSettings" | "getModelStatus" | "transcribe">;

class VoiceMessageNotTranscribed extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "VoiceMessageNotTranscribed";
  }
}

/** A Finder launch has no shell `PATH`, so the folders where installers put `ffmpeg` are added. */
function decoderEnvironment(): NodeJS.ProcessEnv {
  const directories = [...(process.env.PATH ?? "").split(delimiter), "/opt/homebrew/bin", "/usr/local/bin"];
  return { ...process.env, PATH: directories.join(delimiter) };
}

/**
 * The audio file as the WAV that dictation takes: 16 kHz, mono, 16-bit. `ffmpeg` reads only the file
 * itself, so a playlist inside the file cannot make it open another file or address. A recording
 * over the dictation limit fills the output buffer and fails.
 */
const decodeToWav = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync(
        "ffmpeg",
        [
          ...["-nostdin", "-v", "error", "-protocol_whitelist", "file", "-i", path, "-vn"],
          ...["-ac", String(VOICE_AUDIO_LIMITS.channels), "-ar", String(VOICE_AUDIO_LIMITS.sampleRate)],
          ...["-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "wav", "pipe:1"],
        ],
        {
          encoding: "buffer",
          maxBuffer: VOICE_AUDIO_LIMITS.maximumWavBytes,
          timeout: DECODE_TIMEOUT_MS,
          env: decoderEnvironment(),
        },
      );
      if (
        stdout.length <= WAV_HEADER_BYTES ||
        stdout.toString("latin1", WAV_DATA_MARKER_OFFSET, WAV_DATA_MARKER_OFFSET + 4) !== "data"
      )
        throw new VoiceMessageNotTranscribed("no-audio");
      return new Uint8Array(stdout);
    },
    catch: (cause) => (cause instanceof VoiceMessageNotTranscribed ? cause : new VoiceMessageNotTranscribed("decode")),
  });

/**
 * Transcribes the audio file of a chat message with the local dictation model in use. Answers null
 * when no local model is ready, when `ffmpeg` is missing or the audio is too long, and when the
 * transcription fails: the message then arrives as it did before. It never downloads a model and
 * never sends audio to a cloud model.
 */
export function transcribeVoiceMessage(voice: () => VoiceMessageVoice | null) {
  const turn = Semaphore.makeUnsafe(1);
  return (path: string): Effect.Effect<string | null> =>
    turn.withPermit(
      Effect.gen(function* () {
        const service = voice();
        if (!service || !isLocalVoiceModelId(service.getSettings().modelId)) return null;
        if ((yield* service.getModelStatus()).phase !== "ready") return null;
        const { text } = yield* service.transcribe(yield* decodeToWav(path));
        return text.trim() || null;
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            logger.warn(`A voice message was not transcribed (${error instanceof Error ? error.name : "unknown"}).`);
            return null;
          }),
        ),
      ),
    );
}
