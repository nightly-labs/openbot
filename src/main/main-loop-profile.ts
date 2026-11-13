import { Session } from "node:inspector";
import { Effect, Option, Schema } from "effect";
import { AnalyticsOperationFailure } from "./analytics-effects";

/**
 * A CPU profile of the main process for a minute in which the main loop stalls, and its summary: the
 * functions that used the time and who called them. The profile stays in memory. A summary holds
 * function names from the code, the file name of an application file, the name of a package and the
 * name of a Node module. A directory or a URL never reaches a summary, and code with a file outside
 * the application has no name in it.
 */

/** A minute whose longest main-loop delay is at least this long can start or keep a profile. */
export const PROFILE_STALL_MS = 2_000;
/** The functions of one summary in the local file. An analytics event takes the first five. */
const PROFILE_TOP_COUNT = 20;

const SAMPLING_INTERVAL_US = 10_000;
const STACK_DEPTH = 8;
const MAX_NAME_LENGTH = 60;
const EXTERNAL = "(external)";
const ANONYMOUS = "(anonymous)";
// V8's own names for time that no JavaScript function has.
const ENGINE_NAMES = new Set(["(program)", "(garbage collector)", "(idle)", "(root)"]);
const FUNCTION_NAME = /^[A-Za-z_$][\w$.]*$/;
const FILE_NAME = /^[\w.-]+$/;
// A Node module is one name, or a path under `internal` or `electron`. Evaluated text can name any URL.
const NODE_MODULE = /^node:(?:[a-z_]+|(?:internal|electron)\/[a-z0-9_/]+)$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]{0,27}\/)?[a-z0-9][\w.-]{0,27}$/;

/** One frame as a summary holds it. */
const FRAME_PATTERN =
  /^(?:\((?:program|garbage collector|external|anonymous)\)|(?:[A-Za-z_$][\w$.]{0,59}|\(anonymous\)) (?:native|node:(?:[a-z_]{1,60}|(?:internal|electron)\/[a-z0-9_/]{1,50})|npm:(?:@[a-z0-9][\w.-]{0,27}\/)?[a-z0-9][\w.-]{0,27}|app:[\w.-]{1,60}:\d{1,8}))$/;
const STACK_SEPARATOR = " < ";
const MAX_STACK_LENGTH = 900;

interface CpuProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: readonly number[];
}

/** The parts of a V8 `Profiler.Profile` that a summary reads. Times are in microseconds. */
export interface CpuProfile {
  nodes: readonly CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: readonly number[];
  timeDeltas?: readonly number[];
}

interface ProfileFunction {
  /** `name place`: the place is `native`, `node:<module>`, `npm:<package>` or `app:<file>:<line>`. */
  frame: string;
  /** The share of the profiled time that ran in this function itself. */
  selfPct: number;
  /** The callers on the heaviest path to this function, nearest first, joined by ` < `. */
  stack: string;
}

export interface MainLoopProfileSummary {
  profiledMs: number;
  /** The share of the profiled time in which the main thread was not idle. */
  busyPct: number;
  top: ProfileFunction[];
}

/** Whether a value has the shape of a frame that `summarizeCpuProfile` makes. The sender checks again. */
export function isProfileFrame(value: unknown): value is string {
  return typeof value === "string" && FRAME_PATTERN.test(value);
}

export function isProfileStack(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_STACK_LENGTH) return false;
  return value === "" || value.split(STACK_SEPARATOR).every(isProfileFrame);
}

/**
 * The place of a frame with no directory. `appRoot` is the directory of the application's own code.
 * `null` means the code is not the application's, so the frame has no name either.
 */
function framePlace(url: string, lineNumber: number, appRoot: string): string | null {
  if (url === "") return "native";
  if (url.startsWith("node:")) return NODE_MODULE.test(url) && url.length <= 65 ? url : null;
  const path = url.startsWith("file://") ? filePath(url) : url;
  if (path === null) return null;
  const normalized = comparablePath(path);
  const root = comparablePath(appRoot).replace(/\/+$/, "");
  // A path that goes up can end outside the application.
  if (normalized.split("/").some((part) => part === ".." || part === ".")) return null;
  if (root === "" || !normalized.startsWith(`${root}/`)) return null;
  const inside = normalized.slice(root.length + 1);
  const packageAt = inside.lastIndexOf("node_modules/");
  if (packageAt >= 0) {
    const parts = inside.slice(packageAt + "node_modules/".length).split("/");
    const name = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : (parts[0] ?? "");
    return PACKAGE_NAME.test(name) ? `npm:${name}` : null;
  }
  const file = inside.slice(inside.lastIndexOf("/") + 1);
  if (!FILE_NAME.test(file) || file.length > 50) return null;
  return `app:${file}:${Math.max(0, Math.min(99_999_999, Math.trunc(lineNumber) + 1))}`;
}

/** Forward slashes, and a lower-case drive letter: Windows gives `C:` and `c:` for the same disk. */
function comparablePath(path: string): string {
  const slashed = path.replaceAll("\\", "/");
  return /^[A-Za-z]:\//.test(slashed) ? slashed.charAt(0).toLowerCase() + slashed.slice(1) : slashed;
}

function filePath(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const decoded = decodeURIComponent(pathname);
    // `file:///C:/…` on Windows.
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

function frameLabel(node: CpuProfileNode, appRoot: string): string {
  const { functionName, url, lineNumber } = node.callFrame;
  if (ENGINE_NAMES.has(functionName)) return functionName;
  const place = framePlace(url, lineNumber, appRoot);
  if (place === null) return EXTERNAL;
  // A name that is not a plain identifier, such as a getter or a computed key, keeps its place only.
  const name = FUNCTION_NAME.test(functionName) && functionName.length <= MAX_NAME_LENGTH ? functionName : ANONYMOUS;
  // Code with no URL is a V8 builtin or evaluated text. A builtin always has a plain name. A named
  // function of evaluated text keeps that name: nothing tells the two apart.
  if (place === "native" && name === ANONYMOUS) return EXTERNAL;
  const label = `${name} ${place}`;
  return FRAME_PATTERN.test(label) ? label : EXTERNAL;
}

/** Self time by function, and for each function the callers of its heaviest call path. */
export function summarizeCpuProfile(profile: CpuProfile, appRoot: string): MainLoopProfileSummary {
  const selfUs = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const id = samples[index];
    const delta = deltas[index];
    if (id === undefined || delta === undefined || !(delta > 0)) continue;
    selfUs.set(id, (selfUs.get(id) ?? 0) + delta);
  }
  const byId = new Map<number, CpuProfileNode>();
  const parent = new Map<number, number>();
  for (const node of profile.nodes) {
    byId.set(node.id, node);
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  const labels = new Map<number, string>();
  const label = (id: number): string => {
    let value = labels.get(id);
    if (value === undefined) {
      const node = byId.get(id);
      value = node ? frameLabel(node, appRoot) : EXTERNAL;
      labels.set(id, value);
    }
    return value;
  };

  let totalUs = 0;
  let idleUs = 0;
  const functions = new Map<string, { selfUs: number; heaviest: number; heaviestUs: number }>();
  for (const [id, us] of selfUs) {
    totalUs += us;
    const frame = label(id);
    if (frame === "(idle)") {
      idleUs += us;
      continue;
    }
    if (frame === "(root)") continue;
    const entry = functions.get(frame);
    if (!entry) functions.set(frame, { selfUs: us, heaviest: id, heaviestUs: us });
    else {
      entry.selfUs += us;
      if (us > entry.heaviestUs) {
        entry.heaviest = id;
        entry.heaviestUs = us;
      }
    }
  }
  const pct = (us: number) => (totalUs > 0 ? Math.round((us / totalUs) * 1000) / 10 : 0);
  const top = [...functions]
    .sort((left, right) => right[1].selfUs - left[1].selfUs)
    .slice(0, PROFILE_TOP_COUNT)
    .map(([frame, entry]): ProfileFunction => {
      const callers: string[] = [];
      let length = 0;
      let current = parent.get(entry.heaviest);
      while (current !== undefined && callers.length < STACK_DEPTH) {
        const caller = label(current);
        if (caller === "(root)") break;
        // A run of the same frame, such as recursion or unknown code, is one step.
        if (caller !== callers.at(-1)) {
          length += caller.length + STACK_SEPARATOR.length;
          if (length > MAX_STACK_LENGTH) break;
          callers.push(caller);
        }
        current = parent.get(current);
      }
      return { frame, selfPct: pct(entry.selfUs), stack: callers.join(STACK_SEPARATOR) };
    });
  return {
    profiledMs: Math.max(0, Math.round((profile.endTime - profile.startTime) / 1000)),
    busyPct: pct(totalUs - idleUs),
    top,
  };
}

const post = (session: Session, method: string, params?: { interval: number }) =>
  Effect.callback<unknown, AnalyticsOperationFailure>((resume) => {
    try {
      session.post(method, params, (error, result) => {
        resume(error ? Effect.fail(new AnalyticsOperationFailure({ cause: error })) : Effect.succeed(result));
      });
    } catch (cause) {
      resume(Effect.fail(new AnalyticsOperationFailure({ cause })));
    }
  });

const ProfileNode = Schema.Struct({
  id: Schema.Number,
  callFrame: Schema.Struct({ functionName: Schema.String, url: Schema.String, lineNumber: Schema.Number }),
  children: Schema.optionalKey(Schema.Array(Schema.Number)),
});
const decodeStopResult = Schema.decodeUnknownOption(
  Schema.Struct({
    profile: Schema.Struct({
      nodes: Schema.Array(ProfileNode),
      startTime: Schema.Number,
      endTime: Schema.Number,
      samples: Schema.optionalKey(Schema.Array(Schema.Number)),
      timeDeltas: Schema.optionalKey(Schema.Array(Schema.Number)),
    }),
  }),
);

/**
 * One in-process inspector session on the main thread. It needs no debugger port, so it works where
 * the `--inspect` arguments are off. Only one profile runs at a time.
 */
export class MainLoopProfiler {
  #session: Session | null = null;

  get running(): boolean {
    return this.#session !== null;
  }

  readonly start = Effect.fn("MainLoopProfiler.start")(function* (this: MainLoopProfiler) {
    if (this.#session) return;
    const session = new Session();
    this.#session = session;
    yield* Effect.gen(function* () {
      yield* Effect.try({
        try: () => session.connect(),
        catch: (cause) => new AnalyticsOperationFailure({ cause }),
      });
      yield* post(session, "Profiler.enable");
      yield* post(session, "Profiler.setSamplingInterval", { interval: SAMPLING_INTERVAL_US });
      yield* post(session, "Profiler.start");
    }).pipe(Effect.tapError(() => Effect.sync(() => this.discard())));
  });

  /** Ends the profile and returns it, or `null` when none ran. */
  readonly stop = Effect.fn("MainLoopProfiler.stop")(function* (this: MainLoopProfiler) {
    const session = this.#session;
    if (!session) return null;
    return yield* post(session, "Profiler.stop").pipe(
      Effect.map((result): CpuProfile | null => Option.getOrNull(decodeStopResult(result))?.profile ?? null),
      Effect.ensuring(Effect.sync(() => this.discard())),
    );
  });

  /** Ends the profile with no result. Closing the session stops the sampling. */
  discard(): void {
    const session = this.#session;
    this.#session = null;
    try {
      session?.disconnect();
    } catch {
      // The session is gone already.
    }
  }
}
