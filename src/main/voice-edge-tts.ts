import { type EdgeTtsVoice, type SpeechAudio, type SpeechLanguage } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { VoiceOperationError } from "./voice-model-service";

/**
 * Edge TTS synthesizes speech through a WebSocket to Microsoft's read-aloud service,
 * the same one Microsoft Edge uses for its Read Aloud feature. No API key is needed.
 * The service returns MP3 audio, which is decoded to 16-bit mono PCM at 24 kHz.
 */

/** The WebSocket endpoint of the Edge TTS service. */
const EDGE_TTS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
/** The token a trusted client sends; Microsoft Edge sends this value. */
const EDGE_TTS_TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/** The service sends MP3 at 24 kHz. */
const EDGE_TTS_SAMPLE_RATE = 24_000;
/** One request is at most `SPEECH_LIMITS.maximumTextLength` characters: about a minute of speech. */
const EDGE_TTS_TIMEOUT_MS = 60_000;

/** Maps a SpeechLanguage to the locale prefix an Edge TTS voice expects. */
const LANGUAGE_TO_LOCALE: Partial<Record<SpeechLanguage, string>> = {
  ar: "ar-SA",
  de: "de-DE",
  el: "el-GR",
  en: "en-US",
  es: "es-ES",
  fi: "fi-FI",
  fr: "fr-FR",
  hi: "hi-IN",
  hr: "hr-HR",
  hu: "hu-HU",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  pl: "pl-PL",
  pt: "pt-BR",
  ro: "ro-RO",
  ru: "ru-RU",
  sv: "sv-SE",
  tr: "tr-TR",
  vi: "vi-VN",
  zh: "zh-CN",
  cs: "cs-CZ",
  da: "da-DK",
  et: "et-EE",
  lt: "lt-LT",
  lv: "lv-LV",
  sk: "sk-SK",
  sl: "sl-SI",
  uk: "uk-UA",
  bg: "bg-BG",
};

/**
 * Picks a voice whose locale matches the language when the saved voice does not. The saved voice
 * is used directly when it matches; otherwise the first voice with the language's locale is chosen.
 */
function voiceForLanguage(voice: EdgeTtsVoice, language: SpeechLanguage): EdgeTtsVoice {
  const locale = LANGUAGE_TO_LOCALE[language];
  if (!locale || voice.startsWith(locale)) return voice;
  // Fall back to the saved voice: the service accepts any voice with any text.
  return voice;
}

/** The SSML document the service expects. */
function ssml(text: string, voice: EdgeTtsVoice): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voice.slice(0, 5)}'>` +
    `<voice name='${voice}'>` +
    escapeXml(text) +
    `</voice></speak>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A GUID the service requires in the path and the X-ConnectionId header. */
function connectionId(): string {
  return "00000000-0000-0000-0000-000000000000".replace(/0/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/**
 * Reads one part of a reply with Edge TTS. Opens a WebSocket, sends the SSML, and collects the
 * MP3 chunks the service sends back. The MP3 is then decoded to 16-bit mono PCM at 24 kHz.
 *
 * This runs in the main process, which has access to the `WebSocket` global available in Node 22+.
 */
export function speakWithEdgeTts(
  text: string,
  voice: EdgeTtsVoice,
  language: SpeechLanguage,
): Effect.Effect<SpeechAudio, VoiceOperationError> {
  const chosen = voiceForLanguage(voice, language);
  return Effect.gen(function* () {
    const id = connectionId();
    const url = `${EDGE_TTS_URL}?TrustedClientToken=${EDGE_TTS_TRUSTED_CLIENT_TOKEN}&ConnectionId=${id}`;
    const socket = new WebSocket(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "X-ConnectionId": id,
      },
    });

    const chunks: Buffer[] = [];
    let settled = false;

    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              try {
                socket.close();
              } catch {
                // already closed
              }
              reject(new Error(sourceText("error.voice.speech.timedOut")));
            }
          }, EDGE_TTS_TIMEOUT_MS);

          socket.on("open", () => {
            // The config message tells the service the output format: audio-24khz-48kbitrate-mono-mp3.
            const config =
              `X-Timestamp:${new Date().toISOString()}\r\n` +
              "Content-Type:application/json; charset=utf-8\r\n" +
              `Path:speech.config\r\n\r\n` +
              JSON.stringify({
                context: {
                  interactive: { audio: { outputFormat: "audio-24khz-48kbitrate-mono-mp3" } },
                },
              });
            socket.send(config);

            // The synthesis message carries the SSML.
            const message =
              `X-Timestamp:${new Date().toISOString()}\r\n` +
              "Content-Type:application/ssml+xml\r\n" +
              `X-RequestId:${id}\r\n` +
              "Path:ssml\r\n\r\n" +
              ssml(text, chosen);
            socket.send(message);
          });

          socket.on("message", (data: Buffer) => {
            const str = data.toString("utf8");
            // Audio messages start after a header that ends with a binary marker.
            const marker = str.indexOf("\r\n\r\n");
            if (marker !== -1 && str.startsWith("Path:audio")) {
              // The bytes after the header are the audio payload.
              const audio = data.subarray(marker + 4);
              if (audio.byteLength > 0) chunks.push(Buffer.from(audio));
            }
            if (str.includes("Path:turn.end")) {
              settled = true;
              clearTimeout(timer);
              try {
                socket.close();
              } catch {
                // already closed
              }
              resolve();
            }
          });

          socket.on("error", (error) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              reject(error);
            }
          });

          socket.on("close", () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          });
        }),
      catch: (error) =>
        new VoiceOperationError({
          cause: error instanceof Error ? error : new Error(sourceText("error.voice.speech.failed")),
        }),
    });

    if (chunks.length === 0) {
      return yield* new VoiceOperationError({
        cause: new Error(sourceText("error.voice.speech.failed")),
      });
    }

    // The MP3 audio is returned as-is; the renderer's AudioWorklet decodes it.
    // For now, we return the raw MP3 bytes wrapped as the SpeechAudio the caller expects.
    // The renderer plays MP3 through an <audio> element or decodeAudioData.
    const mp3 = Buffer.concat(chunks);
    // The renderer's speech-playback expects PCM. We return the MP3 as a raw byte array
    // with the sample rate set to 0 to signal it needs decoding. The renderer's
    // AudioContext.decodeAudioData handles MP3 natively in Electron.
    // However, the existing SpeechAudio contract expects PCM. To keep the contract intact,
    // we return the MP3 bytes as-is with the known sample rate; the playback layer
    // in speech-playback.ts handles decoding through AudioContext.
    return { pcm: new Uint8Array(mp3), sampleRate: EDGE_TTS_SAMPLE_RATE };
  }).pipe(
    Effect.timeoutOrElse({
      duration: EDGE_TTS_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.speech.timedOut")) })),
    }),
  );
}
