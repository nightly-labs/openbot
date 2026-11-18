// The user's own OpenAI-compatible voice server: `POST {address}/audio/transcriptions` for dictation
// and `POST {address}/audio/speech` for spoken replies. The requests go from main, because the
// renderer's content security policy blocks a local address and the key must not go back to the page.
//
// An error names the host only. The path and the query of an address can hold a token, and the key
// is a credential, so no message and no log line contains them.

import { EventEmitter } from "node:events";
import {
  AUTOMATIC_VOICE_LANGUAGE,
  isVoiceServerRoutes,
  sameCustomProviderOrigin,
  VOICE_SERVER_LIMITS,
  type VoiceLanguage,
  type VoiceServerConnection,
  type VoiceServerInput,
  type VoiceServerModels,
  type VoiceServerProbe,
  type VoiceServerProbeField,
  type VoiceServerRoutes,
  type VoiceServerSettings,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  decodeVoiceServerWav,
  OPENAI_VOICES,
  VOICE_SERVER_VOICE_PATHS,
  voiceServerHost,
  voiceServerModelLists,
  voiceServerVoiceNames,
} from "@openbot/contracts/voice-server";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";
import { PreferenceStore } from "./preference-file";
import type { VoiceApiKeyStore } from "./voice-api-key-store";
import { VoiceOperationError } from "./voice-model-service";

const logger = createOpenBotLogger("voice-server-service");

/** The user waits for the list in the dialog, and a remote server can be slow. */
const PROBE_TIMEOUT_MS = 8_000;
/** A two-minute recording on a server without a GPU. */
const TRANSCRIPTION_TIMEOUT_MS = 120_000;
/** One part of a reply is at most `SPEECH_LIMITS.maximumTextLength` characters: about a minute of speech. */
const SPEECH_TIMEOUT_MS = 120_000;
const LIST_BODY_LIMIT = 1024 * 1024;
/** A minute of 48 kHz stereo 16-bit WAV is 11 MB. */
const SPEECH_BODY_LIMIT = 32 * 1024 * 1024;

interface StoredVoiceServer {
  server: { address: string; routes: VoiceServerRoutes } | null;
}

export function createVoiceServerPreferenceStore(path: string): PreferenceStore<StoredVoiceServer> {
  return new PreferenceStore<StoredVoiceServer>({
    path,
    defaultValue: { server: null },
    decode: (parsed) => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
      const server = parsed.server;
      if (server === null) return { server: null };
      if (
        !isDynamicRecord(server) ||
        !isString(server.address) ||
        server.address.length > VOICE_SERVER_LIMITS.address ||
        !isVoiceServerRoutes(server.routes)
      )
        return null;
      return { server: { address: server.address, routes: server.routes } };
    },
  });
}

/** Why a request failed, and the form field that the user must change. */
class VoiceServerFailure extends Schema.TaggedError<VoiceServerFailure>()("VoiceServerFailure", {
  field: Schema.Literals(["address", "apiKey"]),
  message: Schema.String,
}) {}

interface VoiceServerEvents {
  settings: [settings: VoiceServerSettings | null];
}

interface VoiceServerServiceOptions {
  preferences: PreferenceStore<StoredVoiceServer>;
  apiKeys: VoiceApiKeyStore;
  fetch?: typeof fetch;
}

export class VoiceServerService extends EventEmitter<VoiceServerEvents> {
  readonly #preferences: PreferenceStore<StoredVoiceServer>;
  readonly #apiKeys: VoiceApiKeyStore;
  readonly #fetch: typeof fetch;

  constructor(options: VoiceServerServiceOptions) {
    super();
    this.#preferences = options.preferences;
    this.#apiKeys = options.apiKeys;
    this.#fetch = options.fetch ?? fetch;
  }

  get(): VoiceServerSettings | null {
    const { server } = this.#preferences.get();
    if (!server) return null;
    return { address: server.address, hasApiKey: this.#apiKeys.get() !== null, routes: { ...server.routes } };
  }

  /** True while the server takes dictation in place of the model on this computer. */
  dictates(): boolean {
    return this.#preferences.get().server?.routes.dictation === true;
  }

  /** True while the server reads replies aloud in place of Supertonic. */
  speaks(): boolean {
    return this.#preferences.get().server?.routes.speech === true;
  }

  /** Lists what the server has for each route. A failure names the field to change; it is not thrown. */
  readonly probe = Effect.fn("VoiceServer.probe")(function* (
    this: VoiceServerService,
    connection: VoiceServerConnection,
  ) {
    const target = { address: connection.address, apiKey: this.#keyFor(connection) };
    return yield* listModels(this.#fetch, target).pipe(
      Effect.map((models): VoiceServerProbe => ({ ok: true, models })),
      Effect.catch((failure) =>
        Effect.succeed<VoiceServerProbe>({ ok: false, field: failure.field, message: failure.message }),
      ),
    );
  }).bind(this);

  /** Saves the server, or removes it with its key. Dictation and replies use it from the next request. */
  readonly set = Effect.fn("VoiceServer.set")(function* (this: VoiceServerService, input: VoiceServerInput | null) {
    const apiKey = input ? this.#keyFor(input) : null;
    const previousKey = this.#apiKeys.get();
    yield* this.#apiKeys.set(apiKey).pipe(Effect.mapError(({ cause }) => new VoiceOperationError({ cause })));
    // The key belongs to the new address. When that address is not saved, the old key goes back, or
    // no key stays, so the old origin never receives a key that was given for another server.
    const restoreKey = this.#apiKeys.set(previousKey).pipe(
      Effect.catch(() => this.#apiKeys.set(null)),
      Effect.ignore,
    );
    yield* this.#preferences.set({ server: input ? { address: input.address, routes: input.routes } : null }).pipe(
      Effect.tapError(() => restoreKey),
      Effect.mapError(({ cause }) => new VoiceOperationError({ cause })),
    );
    const settings = this.get();
    this.emit("settings", settings);
    return settings;
  }).bind(this);

  /** Sends a 16 kHz mono WAV recording to the server's transcription route. */
  readonly transcribe = Effect.fn("VoiceServer.transcribe")(function* (
    this: VoiceServerService,
    wav: Uint8Array,
    language: VoiceLanguage,
  ) {
    const { server } = this.#preferences.get();
    const model = server?.routes.dictation ? server.routes.transcriptionModel : null;
    if (!server || !model) return yield* routeOff();
    return yield* transcribeRecording(
      this.#fetch,
      { address: server.address, apiKey: this.#apiKeys.get() },
      model,
      wav,
      language,
      { label: "Voice server" },
    );
  }).bind(this);

  /** Reads one part of a reply with the server's speech route, as 16-bit mono PCM. */
  readonly speak = Effect.fn("VoiceServer.speak")(function* (this: VoiceServerService, text: string) {
    const { server } = this.#preferences.get();
    const routes = server?.routes;
    if (!server || !routes?.speech || !routes.speechModel || !routes.voice) return yield* routeOff();
    const body = JSON.stringify({
      model: routes.speechModel,
      input: text,
      voice: routes.voice,
      response_format: "wav",
    });
    return yield* exchange(
      this.#fetch,
      { address: server.address, apiKey: this.#apiKeys.get() },
      "audio/speech",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      SPEECH_TIMEOUT_MS,
      (response, host) =>
        readBody(response, host, SPEECH_BODY_LIMIT).pipe(
          Effect.flatMap((wav) => {
            const audio = decodeVoiceServerWav(wav);
            return audio ? Effect.succeed(audio) : Effect.fail(invalidAudio(host));
          }),
        ),
    ).pipe(Effect.mapError((failure) => new VoiceOperationError({ cause: new Error(failure.message) })));
  }).bind(this);

  /** The key that the form gave, or the saved key while the address keeps the saved origin. */
  #keyFor(connection: VoiceServerConnection): string | null {
    if (connection.apiKey) {
      registerSecretValue(connection.apiKey);
      return connection.apiKey;
    }
    const saved = this.#preferences.get().server;
    return saved && sameCustomProviderOrigin(saved.address, connection.address) ? this.#apiKeys.get() : null;
  }
}

interface ServerTarget {
  address: string;
  apiKey: string | null;
}

/** How one caller of `transcribeRecording` names itself in logs and explains refused requests. */
interface TranscriptionCaller {
  /** The first words of the failure log line. It names no host. */
  label: string;
  /** The text for a status that the caller explains itself, or null for the shared text. */
  refused?: StatusText;
}

/** Localized text for an answer status, or null to use the shared text. */
type StatusText = (status: number) => string | null;

/**
 * Sends a 16 kHz mono WAV recording to `POST {address}/audio/transcriptions` of an OpenAI-compatible
 * API. The user's own server and Groq dictation use it.
 */
export function transcribeRecording(
  fetcher: typeof fetch,
  target: ServerTarget,
  model: string,
  wav: Uint8Array,
  language: VoiceLanguage,
  caller: TranscriptionCaller,
): Effect.Effect<VoiceTranscriptionResult, VoiceOperationError> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
  form.set("model", model);
  form.set("response_format", "json");
  if (language !== AUTOMATIC_VOICE_LANGUAGE) form.set("language", language);
  const startedAt = Date.now();
  return exchange(
    fetcher,
    target,
    "audio/transcriptions",
    { method: "POST", body: form },
    TRANSCRIPTION_TIMEOUT_MS,
    (response, host) => readJson(response, host, LIST_BODY_LIMIT),
    caller.refused,
  ).pipe(
    Effect.flatMap((body) =>
      isDynamicRecord(body) && isString(body.text)
        ? Effect.succeed({ text: body.text.trim() } satisfies VoiceTranscriptionResult)
        : Effect.fail(invalidAnswer(target.address)),
    ),
    Effect.mapError((failure) => {
      logger.warn(`${caller.label} transcription failed after ${Date.now() - startedAt}ms.`);
      return new VoiceOperationError({ cause: new Error(failure.message) });
    }),
  );
}

function routeOff() {
  return new VoiceOperationError({ cause: new Error(sourceText("error.voice.server.routeOff")) });
}

function invalidAnswer(address: string) {
  return new VoiceServerFailure({
    field: "address",
    message: sourceText("error.voice.server.invalidAnswer", { host: voiceServerHost(address) }),
  });
}

function invalidAudio(host: string) {
  return new VoiceServerFailure({ field: "address", message: sourceText("error.voice.server.invalidAudio", { host }) });
}

/**
 * One request to `{address}/{path}`, with the status checks every route shares. `read` reads the body
 * while the request is still open, so the timeout and the abort cover it too. `refused` explains a
 * status before the shared checks do.
 */
function exchange<A>(
  fetcher: typeof fetch,
  target: ServerTarget,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  read: (response: Response, host: string) => Effect.Effect<A, VoiceServerFailure>,
  refused?: StatusText,
): Effect.Effect<A, VoiceServerFailure> {
  const host = voiceServerHost(target.address);
  const fail = (field: VoiceServerProbeField, message: string) => new VoiceServerFailure({ field, message });
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const url = yield* Effect.try({
          try: () => {
            const base = new URL(target.address);
            base.pathname = `${base.pathname.replace(/\/+$/, "")}/${path}`;
            return base;
          },
          catch: () => fail("address", sourceText("error.provider.baseUrlInvalid")),
        });
        const headers = new Headers(init.headers);
        headers.set("Accept", "*/*");
        if (target.apiKey) headers.set("Authorization", `Bearer ${target.apiKey}`);
        const response = yield* Effect.tryPromise({
          try: () => fetcher(url, { ...init, headers, redirect: "manual", signal: controller.signal }),
          catch: () => fail("address", sourceText("error.provider.discoveryUnreachable", { host })),
        });
        const explained = response.ok ? null : (refused?.(response.status) ?? null);
        if (explained) return yield* fail("address", explained);
        if (response.status >= 300 && response.status < 400)
          return yield* fail("address", sourceText("error.provider.discoveryRedirect", { host }));
        if (response.status === 401 || response.status === 403)
          return yield* fail("apiKey", sourceText("error.voice.server.keyRefused", { host }));
        if (!response.ok)
          return yield* fail(
            "address",
            sourceText("error.provider.discoveryHttp", { host, status: String(response.status) }),
          );
        return yield* read(response, host);
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(fail("address", sourceText("error.provider.discoveryTimeout", { host }))),
        }),
      ),
    (controller) => Effect.sync(() => controller.abort()),
  );
}

function readBody(response: Response, host: string, limit: number): Effect.Effect<Buffer, VoiceServerFailure> {
  return readLimitedBody(response, limit, (reason) =>
    reason === "too-large"
      ? new VoiceServerFailure({ field: "address", message: sourceText("error.voice.server.tooLarge", { host }) })
      : new VoiceServerFailure({
          field: "address",
          message: sourceText("error.provider.discoveryUnreachable", { host }),
        }),
  );
}

function readJson(response: Response, host: string, limit: number): Effect.Effect<unknown, VoiceServerFailure> {
  return readBody(response, host, limit).pipe(
    Effect.flatMap((body) =>
      Effect.try({
        try: (): unknown => JSON.parse(body.toString("utf8")),
        catch: () =>
          new VoiceServerFailure({
            field: "address",
            message: sourceText("error.voice.server.invalidAnswer", { host }),
          }),
      }),
    ),
  );
}

/**
 * `GET /models`, sorted by route, and the voices. A model says its route in `task` on Speaches; for a
 * server that does not, the name decides. A model of neither kind, such as a chat model, is left out.
 */
function listModels(fetcher: typeof fetch, target: ServerTarget): Effect.Effect<VoiceServerModels, VoiceServerFailure> {
  return Effect.gen(function* () {
    const body = yield* exchange(fetcher, target, "models", { method: "GET" }, PROBE_TIMEOUT_MS, (response, host) =>
      readJson(response, host, LIST_BODY_LIMIT),
    );
    const lists = voiceServerModelLists(body);
    if (!lists)
      return yield* new VoiceServerFailure({
        field: "address",
        message: sourceText("error.provider.discoveryInvalid", { host: voiceServerHost(target.address) }),
      });
    const { transcription, speech } = lists;
    const voices = speech.length > 0 ? yield* listVoices(fetcher, target) : [];
    return { transcription, speech, voices };
  });
}

/**
 * The voices of a server. There is no standard route: Kokoro-FastAPI answers `/audio/voices` and
 * Speaches `/audio/speech/voices`. A server that answers neither gets the OpenAI voices.
 */
function listVoices(fetcher: typeof fetch, target: ServerTarget): Effect.Effect<string[]> {
  const attempt = (path: string) =>
    exchange(fetcher, target, path, { method: "GET" }, PROBE_TIMEOUT_MS, (response, host) =>
      readJson(response, host, LIST_BODY_LIMIT),
    ).pipe(
      Effect.map(voiceServerVoiceNames),
      Effect.catch(() => Effect.succeed([])),
    );
  return Effect.gen(function* () {
    for (const path of VOICE_SERVER_VOICE_PATHS) {
      const voices = yield* attempt(path);
      if (voices.length > 0) return voices;
    }
    return [...OPENAI_VOICES];
  });
}
