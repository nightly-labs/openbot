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
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Option, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";
import { VoiceOperationError } from "./voice-model-service";

const logger = createOpenBotLogger("voice-cloud-speech");

const SPEECH_TIMEOUT_MS = 60_000;
const SPEECH_BODY_LIMIT = 16 * 1024 * 1024;
const ERROR_BODY_LIMIT = 16 * 1024;
const REASON_MAX_LENGTH = 300;
const SAMPLE_RATE = 24_000;

const ELEVENLABS_MODELS: Partial<Record<CloudSpeechModelId, { modelId: string; languageCode: boolean }>> = {
  "elevenlabs-flash-v2.5": { modelId: "eleven_flash_v2_5", languageCode: true },
  "elevenlabs-multilingual-v2": { modelId: "eleven_multilingual_v2", languageCode: false },
  "elevenlabs-v3": { modelId: "eleven_v3", languageCode: true },
  "elevenlabs-v4-turbo": { modelId: "eleven_v4_turbo", languageCode: true },
  "elevenlabs-v4": { modelId: "eleven_v4", languageCode: true },
};

const ELEVENLABS_UNLISTED_LANGUAGES: ReadonlySet<SpeechLanguage> = new Set(["et", "lt", "lv", "sl"]);

const ELEVENLABS_VOICE_IDS: Record<ElevenLabsSpeechVoice, string> = {
  alice: "Xb7hH8MSUJpSbSDYk0k2",
  chris: "iP95p4xoKVk53GoZ742B",
  eric: "cjVigY5qzO86Huf0OWal",
  george: "JBFqnCBsd6RMkjVDRZzb",
  jessica: "cgSgspJ2msm6clMCkdW9",
  sarah: "EXAVITQu4vr4xnSDxMaL",
};

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

interface XaiSpeechBody {
  text: string;
  voice_id: XaiSpeechVoice;
  language: string;
  output_format: { codec: "pcm"; sample_rate: number };
}

interface ElevenLabsSpeechBody {
  text: string;
  model_id: string;
  language_code?: SpeechLanguage;
}

const decodeErrorDetail = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      detail: Schema.Union([
        Schema.String,
        Schema.Struct({ status: Schema.optionalKey(Schema.String), message: Schema.optionalKey(Schema.String) }),
      ]),
    }),
  ),
);
const decodeJsonAudio = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ audio: Schema.String })));

export type SpeechFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CloudSpeechRequest {
  model: CloudSpeechModelInfo;
  key: string;
  text: string;
  language: SpeechLanguage;
  elevenLabsVoice: ElevenLabsSpeechVoice;
  xaiVoice: XaiSpeechVoice;
}

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
        if (!response.ok) return yield* errorAnswer(response, request, fail);
        const body = yield* readLimitedBody(response, SPEECH_BODY_LIMIT, () =>
          fail("error.voice.speech.providerFailed"),
        );
        const pcm = (response.headers.get("content-type") ?? "").includes("json") ? jsonAudio(body) : body;
        if (!pcm || pcm.byteLength < 2) return yield* fail("error.voice.speech.providerFailed");
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

function errorAnswer(
  response: Response,
  request: CloudSpeechRequest,
  fail: (key: CloudSpeechErrorKey) => VoiceOperationError,
): Effect.Effect<never, VoiceOperationError> {
  return readLimitedBody(response, ERROR_BODY_LIMIT, () => fail("error.voice.speech.providerFailed")).pipe(
    Effect.orElseSucceed(() => Buffer.alloc(0)),
    Effect.flatMap((body) => {
      const { status, reason } = errorDetail(body, request.key);
      logger.warn(
        `${request.model.provider} refused speech with HTTP ${response.status}${status ? ` (${status})` : ""}.`,
      );
      if (status === "quota_exceeded") return Effect.fail(fail("error.voice.cloud.quotaExceeded"));
      if (response.status === 401 || response.status === 403) return Effect.fail(fail("error.voice.cloud.keyRejected"));
      if (response.status === 429) return Effect.fail(fail("error.voice.cloud.rateLimited"));
      if (reason) return Effect.fail(refused(request, reason));
      return Effect.fail(fail("error.voice.speech.providerFailed"));
    }),
  );
}

function refused(request: CloudSpeechRequest, reason: string): VoiceOperationError {
  const provider = VOICE_KEY_PROVIDER_NAMES[request.model.provider];
  return new VoiceOperationError({
    cause: new Error(sourceText("error.voice.speech.providerRefused", { provider, reason })),
  });
}

function errorDetail(body: Buffer, key: string): { status: string | null; reason: string | null } {
  return Option.match(decodeErrorDetail(body.toString("utf8")), {
    onNone: () => ({ status: null, reason: null }),
    onSome: ({ detail }) => {
      const message = typeof detail === "string" ? detail : (detail.message ?? "");
      const reason = (key ? message.replaceAll(key, "…") : message).trim().slice(0, REASON_MAX_LENGTH);
      return { status: typeof detail === "string" ? null : (detail.status ?? null), reason: reason || null };
    },
  });
}

function jsonAudio(body: Buffer): Buffer | null {
  return Option.match(decodeJsonAudio(body.toString("utf8")), {
    onNone: () => null,
    onSome: (answer) => Buffer.from(answer.audio, "base64"),
  });
}
