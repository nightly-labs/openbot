import {
  isVoiceServerRoutes,
  type SpeechAudio,
  sameCustomProviderOrigin,
  VOICE_SERVER_LIMITS,
  type VoiceServerModels,
  type VoiceServerProbeField,
  type VoiceServerRoutes,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  decodeVoiceServerWav,
  encodeVoiceServerWav,
  OPENAI_VOICES,
  VOICE_SERVER_VOICE_PATHS,
  voiceServerHost,
  voiceServerModelLists,
  voiceServerVoiceNames,
} from "@openbot/contracts/voice-server";
import { sourceText } from "@openbot/i18n/source";
// Not the logged fetch: its log line keeps the path, and the path of a voice server address can
// hold a token. The global fetch of React Native follows redirects; `expo/fetch` obeys `manual`.
import { fetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { saveVoiceSettings, useVoiceSettings } from "./voice-settings";

/** The user waits for the list on the setup page, and a remote server can be slow. */
const PROBE_TIMEOUT_MS = 8_000;
/** A two-minute recording on a server without a GPU. */
const TRANSCRIPTION_TIMEOUT_MS = 120_000;
/** One part of a reply is about a minute of speech at most. */
const SPEECH_TIMEOUT_MS = 120_000;
const LIST_BODY_LIMIT = 1024 * 1024;
/** A minute of 48 kHz stereo 16-bit WAV is 11 MB. */
const SPEECH_BODY_LIMIT = 32 * 1024 * 1024;
/** The capture of the speech module: 16 kHz mono 16-bit PCM. */
const VOICE_SERVER_CAPTURE_RATE = 16_000;

const SERVER_KEY = "openbot.mobile.voice-server.v1";
/** The key stays in the keychain only: no state, log or analytics event holds it. */
const API_KEY_KEY = "openbot.mobile.voice-server-key.v1";

export interface VoiceServer {
  /** The base address of the API, such as `http://studio.local:8000/v1`. */
  address: string;
  routes: VoiceServerRoutes;
}

export const useVoiceServer = create<{ server: VoiceServer | null; hasApiKey: boolean }>(() => ({
  server: null,
  hasApiKey: false,
}));

/** Why a request failed, and the field on the setup page that the user must change. */
export class VoiceServerError extends Error {
  constructor(
    readonly field: VoiceServerProbeField,
    message: string,
  ) {
    super(message);
  }
}

function decodeServer(raw: string | null): VoiceServer | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !isDynamicRecord(value) ||
    !isString(value.address) ||
    value.address.length > VOICE_SERVER_LIMITS.address ||
    !isVoiceServerRoutes(value.routes)
  )
    return null;
  return { address: value.address, routes: value.routes };
}

export async function loadVoiceServer(): Promise<void> {
  const [server, key] = await Promise.all([
    SecureStore.getItemAsync(SERVER_KEY),
    SecureStore.getItemAsync(API_KEY_KEY),
  ]);
  useVoiceServer.setState({ server: decodeServer(server), hasApiKey: Boolean(key) });
}

/**
 * The key for a connection: the one that the page gave, or the saved key while the address keeps
 * the saved origin, so an edited address never receives the old key.
 */
async function keyFor(address: string, apiKey: string | null): Promise<string | null> {
  if (apiKey) return apiKey;
  const saved = useVoiceServer.getState().server;
  return saved && sameCustomProviderOrigin(saved.address, address) ? SecureStore.getItemAsync(API_KEY_KEY) : null;
}

/** Saves the server and its key. A null key keeps the saved key for the same origin, else removes it. */
export async function saveVoiceServer(server: VoiceServer, apiKey: string | null): Promise<void> {
  const key = await keyFor(server.address, apiKey);
  if (key) await SecureStore.setItemAsync(API_KEY_KEY, key);
  else await SecureStore.deleteItemAsync(API_KEY_KEY);
  await SecureStore.setItemAsync(SERVER_KEY, JSON.stringify(server));
  useVoiceServer.setState({ server, hasApiKey: Boolean(key) });
  await stopUnusedRoutes(server);
}

/** Supertonic 3 reads again, and the phone's recognizer listens again, where the server did. */
async function stopUnusedRoutes(server: VoiceServer | null): Promise<void> {
  const { engine, recognition } = useVoiceSettings.getState();
  const speaks = server?.routes.speech === true;
  const dictates = server?.routes.dictation === true;
  if ((engine === "voice-server" && !speaks) || (recognition === "voice-server" && !dictates))
    await saveVoiceSettings({
      engine: engine === "voice-server" && !speaks ? "supertonic" : engine,
      recognition: recognition === "voice-server" && !dictates ? "system" : recognition,
    });
}

export async function removeVoiceServer(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY_KEY);
  await SecureStore.deleteItemAsync(SERVER_KEY);
  useVoiceServer.setState({ server: null, hasApiKey: false });
  await stopUnusedRoutes(null);
}

/** The key goes into an HTTP header: a character outside visible ASCII is refused before a request. */
export function voiceServerKeyProblem(apiKey: string): string | null {
  if (apiKey.length > VOICE_SERVER_LIMITS.apiKey) return sourceText("error.provider.apiKeyTooLong");
  if (apiKey && !/^[\x21-\x7e]+$/u.test(apiKey)) return sourceText("error.provider.keyInvalidCharacters");
  return null;
}

interface Target {
  address: string;
  apiKey: string | null;
}

/**
 * One request to `{address}/{path}`, with the status checks that every route shares. An error names
 * the host only: the path and the query of an address can hold a token.
 */
async function exchange<T extends string | Uint8Array>(
  target: Target,
  path: string,
  init: { method: "GET" | "POST"; body?: FormData | string; contentType?: string },
  timeoutMs: number,
  limit: number,
  read: (response: Response) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const host = voiceServerHost(target.address);
  let url: URL;
  try {
    url = new URL(target.address);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Not an HTTP address.");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}`;
  } catch {
    throw new VoiceServerError("address", sourceText("error.provider.baseUrlInvalid"));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  try {
    const headers: Record<string, string> = { Accept: "*/*" };
    if (init.contentType) headers["Content-Type"] = init.contentType;
    if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: init.method,
        body: init.body,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VoiceServerError(
        "address",
        sourceText(
          controller.signal.aborted ? "error.provider.discoveryTimeout" : "error.provider.discoveryUnreachable",
          {
            host,
          },
        ),
      );
    }
    if (response.status >= 300 && response.status < 400)
      throw new VoiceServerError("address", sourceText("error.provider.discoveryRedirect", { host }));
    if (response.status === 401 || response.status === 403)
      throw new VoiceServerError("apiKey", sourceText("error.voice.server.keyRefused", { host }));
    if (!response.ok)
      throw new VoiceServerError(
        "address",
        sourceText("error.provider.discoveryHttp", { host, status: String(response.status) }),
      );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit)
      throw new VoiceServerError("address", sourceText("error.voice.server.tooLarge", { host }));
    let body: T;
    try {
      body = await read(response);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new VoiceServerError(
        "address",
        sourceText(
          controller.signal.aborted ? "error.provider.discoveryTimeout" : "error.provider.discoveryUnreachable",
          {
            host,
          },
        ),
      );
    }
    if (body.length > limit) throw new VoiceServerError("address", sourceText("error.voice.server.tooLarge", { host }));
    return body;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function invalidAnswer(target: Target): VoiceServerError {
  return new VoiceServerError(
    "address",
    sourceText("error.voice.server.invalidAnswer", { host: voiceServerHost(target.address) }),
  );
}

const asText = (response: Response) => response.text();
const asBytes = async (response: Response) => new Uint8Array(await response.arrayBuffer());

/** The JSON answer of the server, read by `decode`. */
function readJson<T>(target: Target, body: string, decode: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw invalidAnswer(target);
  }
  return decode(value);
}

/** The voices of a server, or the OpenAI voices when it lists none. */
async function listVoices(target: Target): Promise<string[]> {
  for (const path of VOICE_SERVER_VOICE_PATHS) {
    try {
      const voices = readJson(
        target,
        await exchange(target, path, { method: "GET" }, PROBE_TIMEOUT_MS, LIST_BODY_LIMIT, asText),
        voiceServerVoiceNames,
      );
      if (voices.length > 0) return voices;
    } catch {
      // The next list, then the OpenAI voices.
    }
  }
  return [...OPENAI_VOICES];
}

/** What the server has for dictation and spoken replies, as the desktop setup lists it. */
export async function probeVoiceServer(address: string, apiKey: string | null): Promise<VoiceServerModels> {
  const target = { address, apiKey: await keyFor(address, apiKey) };
  const lists = readJson(
    target,
    await exchange(target, "models", { method: "GET" }, PROBE_TIMEOUT_MS, LIST_BODY_LIMIT, asText),
    voiceServerModelLists,
  );
  if (!lists)
    throw new VoiceServerError(
      "address",
      sourceText("error.provider.discoveryInvalid", { host: voiceServerHost(address) }),
    );
  const voices = lists.speech.length > 0 ? await listVoices(target) : [];
  return { ...lists, voices };
}

async function savedTarget(): Promise<{ server: VoiceServer; target: Target }> {
  const server = useVoiceServer.getState().server;
  if (!server) throw new VoiceServerError("address", sourceText("error.voice.server.routeOff"));
  return { server, target: { address: server.address, apiKey: await SecureStore.getItemAsync(API_KEY_KEY) } };
}

/**
 * Sends a recording of the speech module (16 kHz mono 16-bit PCM) to `POST /audio/transcriptions`.
 * The WAV file is in the cache folder only while the request runs.
 */
export async function transcribeWithVoiceServer(
  pcm: Uint8Array,
  language: string | null,
  signal: AbortSignal,
): Promise<string> {
  const { server, target } = await savedTarget();
  const model = server.routes.dictation ? server.routes.transcriptionModel : null;
  if (!model) throw new VoiceServerError("address", sourceText("error.voice.server.routeOff"));
  const file = new File(Paths.cache, `voice-server-${Crypto.randomUUID()}.wav`);
  try {
    await file.write(encodeVoiceServerWav(pcm, VOICE_SERVER_CAPTURE_RATE));
    const form = new FormData();
    // A file of `expo-file-system` is a Blob, which the request sends from its address.
    form.append("file", file, "audio.wav");
    form.append("model", model);
    form.append("response_format", "json");
    if (language) form.append("language", language);
    return readJson(
      target,
      await exchange(
        target,
        "audio/transcriptions",
        { method: "POST", body: form },
        TRANSCRIPTION_TIMEOUT_MS,
        LIST_BODY_LIMIT,
        asText,
        signal,
      ),
      (value) => {
        if (!isDynamicRecord(value) || !isString(value.text)) throw invalidAnswer(target);
        return value.text.trim();
      },
    );
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // The system clears the cache folder itself when it needs the space.
    }
  }
}

/** Reads one part of a reply with `POST /audio/speech`, as 16-bit mono PCM. */
export async function voiceServerSpeech(text: string, signal: AbortSignal, voice?: string): Promise<SpeechAudio> {
  const { server, target } = await savedTarget();
  const { speech, speechModel } = server.routes;
  const chosen = voice ?? server.routes.voice;
  if (!speech || !speechModel || !chosen)
    throw new VoiceServerError("address", sourceText("error.voice.server.routeOff"));
  const wav = await exchange(
    target,
    "audio/speech",
    {
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({ model: speechModel, input: text, voice: chosen, response_format: "wav" }),
    },
    SPEECH_TIMEOUT_MS,
    SPEECH_BODY_LIMIT,
    asBytes,
    signal,
  );
  const audio = decodeVoiceServerWav(wav);
  if (!audio)
    throw new VoiceServerError(
      "address",
      sourceText("error.voice.server.invalidAudio", { host: voiceServerHost(server.address) }),
    );
  return audio;
}
