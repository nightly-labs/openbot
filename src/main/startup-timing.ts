import { uptime } from "node:os";
import { join } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";
import { quantize } from "./resource-summary";

const STARTUP_FILE = "startup-history.json";
/** Without the workspace's first load, the summary goes this long after the renderer loaded. */
const WORKSPACE_WAIT_MS = 2 * 60_000;

/**
 * `warm`: OpenBot started earlier since the computer booted. `cold`: the first start since the boot.
 * `updated`: the first start of this app version. `unknown`: no earlier start is saved, or the saved
 * start was not read before the summary went.
 *
 * The boot time comes from the system uptime. Windows Fast Startup resumes the kernel instead of a
 * full boot, so the uptime continues and a start after a shut down can show as `warm`.
 */
export const START_KINDS = ["warm", "cold", "updated", "unknown"] as const;
export type StartKind = (typeof START_KINDS)[number];

/** The steps of `createApplicationServices`, in order. Each `openbot:services.<step>` mark ends one. */
export const SERVICE_STEPS = [
  "pre-store",
  "store",
  "skills",
  "browser",
  "preferences",
  "provider-detection",
  "mcp-sign-in-file",
  "connectors",
  "computer-use",
  "routines",
  "messaging",
  "team",
  "hosted",
  "remote-desktop",
  "plugin-catalog",
  "remote-servers",
  "updates",
  "host-update",
] as const;
type ServiceStep = (typeof SERVICE_STEPS)[number];
/** `service_pre_store_ms` for `pre-store`: the time of one step. */
type ServiceStepProperty = `service_${Snake<ServiceStep>}_ms`;
type Snake<T extends string> = T extends `${infer Head}-${infer Tail}` ? `${Head}_${Snake<Tail>}` : T;

// The template type cannot follow a runtime `replaceAll`, so this list maps each name once.
const SERVICE_STEP_PROPERTIES = {
  "pre-store": "service_pre_store_ms",
  store: "service_store_ms",
  skills: "service_skills_ms",
  browser: "service_browser_ms",
  preferences: "service_preferences_ms",
  "provider-detection": "service_provider_detection_ms",
  "mcp-sign-in-file": "service_mcp_sign_in_file_ms",
  connectors: "service_connectors_ms",
  "computer-use": "service_computer_use_ms",
  routines: "service_routines_ms",
  messaging: "service_messaging_ms",
  team: "service_team_ms",
  hosted: "service_hosted_ms",
  "remote-desktop": "service_remote_desktop_ms",
  "plugin-catalog": "service_plugin_catalog_ms",
  "remote-servers": "service_remote_servers_ms",
  updates: "service_updates_ms",
  "host-update": "service_host_update_ms",
} as const satisfies { readonly [Step in ServiceStep]: `service_${Snake<Step>}_ms` };

/** The property names of the step times, in step order. */
export const SERVICE_STEP_PROPERTY_NAMES = SERVICE_STEPS.map((step) => SERVICE_STEP_PROPERTIES[step]);

/**
 * Milliseconds after the main process started, at two significant digits. A
 * `service_<step>_ms` value is the length of that step instead.
 */
export interface StartupProperties extends Partial<Record<ServiceStepProperty, number>> {
  start_kind: StartKind;
  host_kind: "desktop" | "server";
  when_ready_ms?: number;
  window_ready_ms?: number;
  services_ready_ms?: number;
  renderer_loaded_ms?: number;
  workspace_ready_ms?: number;
  slowest_service_step?: ServiceStep;
  slowest_service_step_ms?: number;
}

export interface StartupTimingOptions {
  userDataPath: string;
  appVersion: string;
  server: boolean;
  send: (properties: StartupProperties) => void;
}

interface SavedStart {
  version: 1;
  appVersion: string;
  startedAt: number;
}

function decodeSavedStart(value: unknown): SavedStart | null {
  if (!isDynamicRecord(value) || value.version !== 1) return null;
  if (!isString(value.appVersion) || !isNumber(value.startedAt) || !Number.isFinite(value.startedAt)) return null;
  return { version: 1, appVersion: value.appVersion, startedAt: value.startedAt };
}

function startKind(saved: SavedStart | null, appVersion: string, bootedAt: number): StartKind {
  if (!saved) return "unknown";
  if (saved.appVersion !== appVersion) return "updated";
  return saved.startedAt < bootedAt ? "cold" : "warm";
}

function markMs(name: string): number | undefined {
  const value = performance.getEntriesByName(`openbot:${name}`, "mark")[0]?.startTime;
  return value === undefined || !Number.isFinite(value) || value < 0 ? undefined : value;
}

/**
 * The length of each step between the `openbot:services.*` marks. The first step starts at
 * `services.start`, the top of `createApplicationServices`, so it does not include the window.
 * A step with no mark has no length, and the next step starts at the last mark before it.
 */
function serviceStepTimes(): { step: ServiceStep; ms: number }[] {
  let previous = markMs("services.start") ?? markMs("when-ready");
  const times: { step: ServiceStep; ms: number }[] = [];
  for (const step of SERVICE_STEPS) {
    const end = markMs(`services.${step}`);
    if (end === undefined) continue;
    if (previous !== undefined) times.push({ step, ms: Math.max(0, end - previous) });
    previous = end;
  }
  return times;
}

/**
 * One `system_startup` summary per main process: the startup marks that `dev:bench` reads, and the
 * workspace's first load that the renderer reports. Main times all of them on its own clock.
 */
export class StartupTiming {
  readonly #options: StartupTimingOptions;
  #startKind: StartKind = "unknown";
  #workspaceReadyMs: number | null = null;
  #rendererLoaded = false;
  #timer: NodeJS.Timeout | null = null;
  #sent = false;

  constructor(options: StartupTimingOptions) {
    this.#options = options;
  }

  /**
   * Reads the last start and saves this one. A file that cannot be read or saved gives `unknown`.
   * Not on the startup path: the summary goes much later, at the workspace's first load.
   */
  readonly recordStart = Effect.fn("StartupTiming.recordStart")(function* (this: StartupTiming) {
    const path = join(this.#options.userDataPath, STARTUP_FILE);
    const saved = yield* readPreferenceFile(path, decodeSavedStart).pipe(Effect.catch(() => Effect.succeed(null)));
    const now = Date.now();
    this.#startKind = startKind(saved, this.#options.appVersion, now - uptime() * 1_000);
    yield* writePreferenceFile(path, { version: 1, appVersion: this.#options.appVersion, startedAt: now }).pipe(
      Effect.ignore,
    );
  });

  /** The main window loaded. The summary goes at the workspace's first load, or after a wait. */
  rendererLoaded(): void {
    if (this.#sent || this.#rendererLoaded) return;
    this.#rendererLoaded = true;
    if (this.#workspaceReadyMs !== null) {
      this.#send();
      return;
    }
    this.#timer = setTimeout(() => this.#send(), WORKSPACE_WAIT_MS);
    this.#timer.unref();
  }

  /** The main window's workspace finished its first load. Later loads, after a reload, do not count. */
  workspaceReady(): void {
    if (this.#sent || this.#workspaceReadyMs !== null) return;
    this.#workspaceReadyMs = performance.now();
    if (this.#rendererLoaded) this.#send();
  }

  dispose(): void {
    this.#sent = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #send(): void {
    if (this.#sent) return;
    this.#sent = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const properties: StartupProperties = {
      start_kind: this.#startKind,
      host_kind: this.#options.server ? "server" : "desktop",
    };
    const values: [
      Exclude<keyof StartupProperties, "start_kind" | "host_kind" | "slowest_service_step">,
      number | undefined,
    ][] = [
      ["when_ready_ms", markMs("when-ready")],
      ["window_ready_ms", markMs("window-ready")],
      ["services_ready_ms", markMs("services-built")],
      ["renderer_loaded_ms", markMs("renderer-loaded")],
      ["workspace_ready_ms", this.#workspaceReadyMs ?? undefined],
    ];
    for (const [key, value] of values) if (value !== undefined) properties[key] = quantize(value);
    let slowest: { step: ServiceStep; ms: number } | null = null;
    for (const time of serviceStepTimes()) {
      properties[SERVICE_STEP_PROPERTIES[time.step]] = quantize(time.ms);
      if (slowest === null || time.ms > slowest.ms) slowest = time;
    }
    if (slowest) {
      properties.slowest_service_step = slowest.step;
      properties.slowest_service_step_ms = quantize(slowest.ms);
    }
    this.#options.send(properties);
  }
}
