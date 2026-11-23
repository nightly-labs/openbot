import { type HostSignalHomeSettings, isSignalHomeId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { PreferenceStore, readPreferenceFile } from "./preference-file";
import { signalHttpOrigin } from "./telegram-files";

export const SIGNAL_HOME_PREFERENCE_FILE = "openbot-signal-home-v1.json";

const LATENCY_SAMPLES = 3;
const LATENCY_TIMEOUT_MS = 3_000;
const LATENCY_REUSE_MS = 60_000;

export class HostSignalHomeError extends Schema.TaggedError<HostSignalHomeError>()("HostSignalHomeError", {
  cause: Schema.Defect(),
}) {}

export class SignalHomeUnknownError extends Schema.TaggedError<SignalHomeUnknownError>()("SignalHomeUnknownError", {
  cause: Schema.Defect(),
}) {}

export interface ListedSignalHome {
  readonly id: string;
  readonly url: string;
}

type SignalHomeFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface HostSignalHomeOptions {
  path: string;
  fetch: SignalHomeFetch;
  listHomes: () => Effect.Effect<readonly ListedSignalHome[], { readonly cause: unknown }>;
  currentHome: () => string | null;
  followHome: () => Effect.Effect<void>;
}

interface SignalHomePreference {
  home: string | null;
}

function decodeSignalHomePreference(parsed: unknown): SignalHomePreference | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
  return { home: isSignalHomeId(parsed.home) ? parsed.home : null };
}

const measureOnce = (fetcher: SignalHomeFetch, url: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const started = performance.now();
      const response = await fetcher(url, {
        method: "GET",
        signal: AbortSignal.any([signal, AbortSignal.timeout(LATENCY_TIMEOUT_MS)]),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Signal health answered ${response.status}.`);
      return performance.now() - started;
    },
    catch: (cause) => new HostSignalHomeError({ cause }),
  });

export const measureSignalLatency = Effect.fn("HostSignalHome.measureLatency")(function* (
  fetcher: SignalHomeFetch,
  signalUrl: string,
) {
  const url = `${signalHttpOrigin(signalUrl)}/health/ready`;
  yield* measureOnce(fetcher, url);
  const samples: number[] = [];
  for (let sample = 0; sample < LATENCY_SAMPLES; sample += 1) samples.push(yield* measureOnce(fetcher, url));
  samples.sort((left, right) => left - right);
  return Math.round(samples[Math.floor(samples.length / 2)] ?? 0);
});

export class HostSignalHomeService {
  readonly #options: HostSignalHomeOptions;
  readonly #preference: PreferenceStore<SignalHomePreference>;
  readonly #measured = new Map<string, { at: number; latencyMs: number | null }>();

  constructor(options: HostSignalHomeOptions) {
    this.#options = options;
    this.#preference = new PreferenceStore({
      path: options.path,
      defaultValue: { home: null },
      decode: decodeSignalHomePreference,
    });
  }

  load() {
    return this.#preference.load();
  }

  preferred(): string | null {
    return this.#preference.get().home;
  }

  readonly snapshot = Effect.fn("HostSignalHome.snapshot")(function* (this: HostSignalHomeService) {
    const listed = yield* this.#options.listHomes();
    const homes = yield* Effect.forEach(
      listed,
      (home) => this.#latency(home.url).pipe(Effect.map((latencyMs) => ({ id: home.id, latencyMs }))),
      { concurrency: "unbounded" },
    );
    return {
      preferred: this.preferred(),
      current: this.#options.currentHome(),
      homes,
    } satisfies HostSignalHomeSettings;
  }).bind(this);

  #latency(url: string): Effect.Effect<number | null> {
    return Effect.suspend(() => {
      const known = this.#measured.get(url);
      if (known && Date.now() - known.at < LATENCY_REUSE_MS) return Effect.succeed(known.latencyMs);
      return measureSignalLatency(this.#options.fetch, url).pipe(
        Effect.orElseSucceed(() => null),
        Effect.tap((latencyMs) =>
          Effect.sync(() => {
            this.#measured.set(url, { at: Date.now(), latencyMs });
          }),
        ),
      );
    });
  }

  readonly answers = Effect.fn("HostSignalHome.answers")(function* (this: HostSignalHomeService, home: string) {
    const listed = yield* this.#options.listHomes().pipe(Effect.orElseSucceed(() => []));
    const url = listed.find((entry) => entry.id === home)?.url;
    return url !== undefined && (yield* this.#latency(url)) !== null;
  }).bind(this);

  readonly set = Effect.fn("HostSignalHome.set")(function* (this: HostSignalHomeService, home: string | null) {
    if (home !== null && !(yield* this.#options.listHomes()).some((listed) => listed.id === home))
      return yield* new SignalHomeUnknownError({ cause: new Error(sourceText("error.host.signalHomeUnknown")) });
    yield* this.#preference.set({ home });
    yield* this.#options.followHome();
    return yield* this.snapshot();
  }).bind(this);
}

export function readSignalHomeChoice(path: string): Effect.Effect<string | null> {
  return readPreferenceFile(path, decodeSignalHomePreference).pipe(
    Effect.map((preference) => preference?.home ?? null),
    Effect.orElseSucceed(() => null),
  );
}
