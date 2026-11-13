import {
  type CloudSpeechModelId,
  type CloudSpeechModelInfo,
  type ElevenLabsSpeechVoice,
  type SpeechAudio,
  type SpeechLanguage,
  VOICE_KEY_PROVIDER_NAMES,
  type XaiSpeechVoice,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Option, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";
import { VoiceOperationError } from "./voice-model-service";

/** One request is at most `SPEECH_LIMITS.maximumTextLength` characters: about a minute of speech. */
const SPEECH_TIMEOUT_MS = 60_000;
/** A minute of 24 kHz 16-bit PCM is about 2.9 MB. The base64 JSON answer of xAI is a third larger. */
const SPEECH_BODY_LIMIT = 16 * 1024 * 1024;
/** An error answer is a short JSON object. */
const ERROR_BODY_LIMIT = 16 * 1024;
const SAMPLE_RATE = 24_000;

const ELEVENLABS_MODELS: Partial<Record<CloudSpeechModelId, { modelId: string; languageCode: boolean }>> = {
  "elevenlabs-flash-v2.5": { modelId: "eleven_flash_v2_5", languageCode: true },
  // ElevenLabs does not accept `language_code` for Multilingual v2: it finds the language itself.
  "elevenlabs-multilingual-v2": { modelId: "eleven_multilingual_v2", languageCode: false },
  "elevenlabs-v3": { modelId: "eleven_v3", languageCode: true },
  "elevenlabs-v4-turbo": { modelId: "eleven_v4_turbo", languageCode: true },
  "elevenlabs-v4": { modelId: "eleven_v4", languageCode: true },
};

/**
 * ElevenLabs refuses a `language_code` that the model does not support. Flash v2.5 does not list
 * Estonian, Latvian, Lithuanian or Slovenian, so the model finds these languages itself.
 */
const ELEVENLABS_UNLISTED_LANGUAGES: ReadonlySet<SpeechLanguage> = new Set(["et", "lt", "lv", "sl"]);

/** The voice IDs of the ElevenLabs default voices. */
const ELEVENLABS_VOICE_IDS: Record<ElevenLabsSpeechVoice, string> = {
  alice: "Xb7hH8MSUJpSbSDYk0k2",
  chris: "iP95p4xoKVk53GoZ742B",
  eric: "cjVigY5qzO86Huf0OWal",
  george: "JBFqnCBsd6RMkjVDRZzb",
  jessica: "cgSgspJ2msm6clMCkdW9",
  sarah: "EXAVITQu4vr4xnSDxMaL",
};

/** The languages that xAI names with a region. xAI finds every other language that it does not list. */
const XAI_LANGUAGES: Partial<Record<SpeechLanguage, string>> = {
  ar: "ar-SA",
  de: "de",
  en: "en",
  es: "es-ES",
  fr: "fr",
  hi: "hi",
  id: "id",
  it: "it",
  ja: "ja",
  ko: "ko",
  pt: "pt-BR",
  ru: "ru",
  tr: "tr",
  vi: "vi",
};

/** The request body of xAI text to speech. */
interface XaiSpeechBody {
  text: string;
  voice_id: XaiSpeechVoice;
  language: string;
  output_format: { codec: "pcm"; sample_rate: number };
}

/** The request body of ElevenLabs text to speech. */
interface ElevenLabsSpeechBody {
  text: string;
  model_id: string;
  language_code?: SpeechLanguage;
}

/** ElevenLabs names a used-up quota in `detail.status`. */
const decodeErrorStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ detail: Schema.Struct({ status: Schema.String }) })),
);
/** xAI can answer with JSON `{ "audio": "<base64>" }`. */
const decodeJsonAudio = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ audio: Schema.String })));

/** The `fetch` of the main process, or a test's. */
export type SpeechFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CloudSpeechRequest {
  model: CloudSpeechModelInfo;
  key: string;
  text: string;
  language: SpeechLanguage;
  elevenLabsVoice: ElevenLabsSpeechVoice;
  xaiVoice: XaiSpeechVoice;
}

/**
 * Reads one part of a reply at the model's provider, with the user's own key, as 24 kHz 16-bit mono
 * PCM. The key goes only in the request header. An error names the provider, never the key.
 */
export function speakInCloud(
  fetcher: SpeechFetch,
  request: CloudSpeechRequest,
): Effect.Effect<SpeechAudio, VoiceOperationError> {
  if (request.model.provider === "xai") {
    const language = XAI_LANGUAGES[request.language] ?? "auto";
    return exchange(fetcher, request, "https://api.x.ai/v1/tts", {
      headers: { Authorization: `Bearer ${request.key}` },
      body: {
        text: request.text,
        voice_id: request.xaiVoice,
        language,
        output_format: { codec: "pcm", sample_rate: SAMPLE_RATE },
      },
    });
  }
  const model = ELEVENLABS_MODELS[request.model.id];
  if (!model) return Effect.fail(failure(request, "error.voice.speech.providerFailed"));
  const voiceId = ELEVENLABS_VOICE_IDS[request.elevenLabsVoice];
  return exchange(
    fetcher,
    request,
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${SAMPLE_RATE}`,
    {
      headers: { "xi-api-key": request.key },
      body: {
        text: request.text,
        model_id: model.modelId,
        ...(model.languageCode && !ELEVENLABS_UNLISTED_LANGUAGES.has(request.language)
          ? { language_code: request.language }
          : {}),
      },
    },
  );
}

function exchange(
  fetcher: SpeechFetch,
  request: CloudSpeechRequest,
  url: string,
  init: { headers: Record<string, string>; body: XaiSpeechBody | ElevenLabsSpeechBody },
): Effect.Effect<SpeechAudio, VoiceOperationError> {
  const fail = (key: CloudSpeechErrorKey) => failure(request, key);
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetcher(url, {
              method: "POST",
              headers: { ...init.headers, "Content-Type": "application/json", Accept: "*/*" },
              body: JSON.stringify(init.body),
              redirect: "manual",
              signal: controller.signal,
            }),
          catch: () => fail("error.voice.speech.providerUnreachable"),
        });
        if (!response.ok) return yield* errorAnswer(response, fail);
        const body = yield* readLimitedBody(response, SPEECH_BODY_LIMIT, () =>
          fail("error.voice.speech.providerFailed"),
        );
        const pcm = (response.headers.get("content-type") ?? "").includes("json") ? jsonAudio(body) : body;
        if (!pcm || pcm.byteLength < 2) return yield* fail("error.voice.speech.providerFailed");
        // A 16-bit sample has two bytes. An odd last byte is not a sample.
        return { pcm: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength & ~1), sampleRate: SAMPLE_RATE };
      }).pipe(
        Effect.timeoutOrElse({
          duration: SPEECH_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(new VoiceOperationError({ cause: new Error(sourceText("error.voice.speech.timedOut")) })),
        }),
      ),
    (controller) => Effect.sync(() => controller.abort()),
  );
}

function failure(request: CloudSpeechRequest, key: CloudSpeechErrorKey): VoiceOperationError {
  const provider = VOICE_KEY_PROVIDER_NAMES[request.model.provider];
  return new VoiceOperationError({ cause: new Error(sourceText(key, { provider })) });
}

type CloudSpeechErrorKey =
  | "error.voice.cloud.keyRejected"
  | "error.voice.cloud.quotaExceeded"
  | "error.voice.cloud.rateLimited"
  | "error.voice.speech.providerFailed"
  | "error.voice.speech.providerUnreachable";

/** Maps an error answer. ElevenLabs names a used-up quota in `detail.status`. */
function errorAnswer(
  response: Response,
  fail: (key: CloudSpeechErrorKey) => VoiceOperationError,
): Effect.Effect<never, VoiceOperationError> {
  return readLimitedBody(response, ERROR_BODY_LIMIT, () => fail("error.voice.speech.providerFailed")).pipe(
    Effect.orElseSucceed(() => Buffer.alloc(0)),
    Effect.flatMap((body) => {
      if (errorStatus(body) === "quota_exceeded") return Effect.fail(fail("error.voice.cloud.quotaExceeded"));
      if (response.status === 401 || response.status === 403) return Effect.fail(fail("error.voice.cloud.keyRejected"));
      if (response.status === 429) return Effect.fail(fail("error.voice.cloud.rateLimited"));
      return Effect.fail(fail("error.voice.speech.providerFailed"));
    }),
  );
}

function errorStatus(body: Buffer): string | null {
  return Option.match(decodeErrorStatus(body.toString("utf8")), {
    onNone: () => null,
    onSome: (answer) => answer.detail.status,
  });
}

/** The PCM of a JSON answer `{ "audio": "<base64>" }`, or null. */
function jsonAudio(body: Buffer): Buffer | null {
  return Option.match(decodeJsonAudio(body.toString("utf8")), {
    onNone: () => null,
    onSome: (answer) => Buffer.from(answer.audio, "base64"),
  });
}
