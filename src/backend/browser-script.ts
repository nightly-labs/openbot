import releaseSyncVariant from "@jitl/quickjs-wasmfile-release-sync";
import type { BrowserJsonValue, BrowserSnapshot } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";
import { browserCall, browserSync } from "./browser-effects";
import { type BrowserStep, parseBrowserStep } from "./browser-tools";
import { withTimeout } from "./with-timeout";

const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const STACK_LIMIT_BYTES = 1024 * 1024;
const RESULT_LIMIT_CHARS = 64_000;
const ERROR_LIMIT_CHARS = 2_000;
const LOG_LIMIT_ENTRIES = 100;
const LOG_LIMIT_CHARS = 8_000;

/** The outcome of one step that a `run_script` helper asked for. */
export type BrowserStepOutcome =
  | { status: "ok"; value?: BrowserJsonValue | BrowserSnapshot }
  | { status: "error"; error: string }
  | { status: "user_control" }
  | { status: "tab_closed" };

export const BROWSER_SCRIPT_USER_CONTROL_ERROR =
  "A person took control of the tab. Wait for the release, then take a fresh snapshot.";

export interface BrowserScriptResult {
  status: "completed" | "failed" | "timeout" | "step_limit" | "user_control" | "tab_closed";
  value?: BrowserJsonValue;
  error?: string;
  steps: number;
  log?: string[];
}

interface BrowserScriptOptions {
  script: string;
  timeoutMs: number;
  maxSteps: number;
  /** Runs one step on the tab. A failed step is an outcome, not an error. */
  runStep: (step: BrowserStep) => Effect.Effect<BrowserStepOutcome>;
}

// The helpers the script awaits. Each one sends a single step through `__step`, which the host runs
// with every check of the matching tool. They live in the sandbox, so a script can change them only
// for itself.
const PRELUDE = `
const __target = (target) => (typeof target === "string" ? { kind: "css", selector: target } : target);
const __with = (step, options) => ({ ...step, ...(options ?? {}) });
globalThis.css = (selector) => ({ kind: "css", selector });
globalThis.role = (role, name, exact) => ({
  kind: "role", role, ...(name === undefined ? {} : { name }), ...(exact === undefined ? {} : { exact }),
});
globalThis.text = (text, exact) => ({ kind: "text", text, ...(exact === undefined ? {} : { exact }) });
globalThis.step = async (step) => {
  const result = await __step(JSON.stringify(step));
  return result === undefined ? undefined : JSON.parse(result);
};
globalThis.navigate = (url, options) =>
  step(__with(typeof url === "string" ? { action: "navigate", url } : { action: "navigate", ...url }, options));
globalThis.click = (target, options) => step(__with({ action: "click", target: __target(target) }, options));
globalThis.type = (target, text, options) =>
  step(__with({ action: "type", ...(target == null ? {} : { target: __target(target) }), text }, options));
globalThis.press = (key, target, options) =>
  step(__with({ action: "press", key, ...(target == null ? {} : { target: __target(target) }) }, options));
globalThis.hover = (target, options) => step(__with({ action: "hover", target: __target(target) }, options));
globalThis.scroll = (deltaY, target, options) =>
  step(__with({ action: "scroll", deltaY, ...(target == null ? {} : { target: __target(target) }) }, options));
globalThis.selectOption = (target, values, options) =>
  step(__with({ action: "select_option", target: __target(target), values: [].concat(values) }, options));
globalThis.setChecked = (target, checked = true, options) =>
  step(__with({ action: "set_checked", target: __target(target), checked }, options));
globalThis.waitFor = (condition, options) => {
  // A page function is polled in the page until it returns a truthy value, as one evaluate step.
  if (typeof condition === "function") {
    const timeoutMs = Math.min(options?.timeoutMs ?? 10000, 25000);
    return evaluate(
      "new Promise((resolve, reject) => { const end = Date.now() + " + timeoutMs + "; const check = async () => {" +
        " try { if (await (" + String(condition) + ")()) return resolve(true); } catch (error) { return reject(error); }" +
        " if (Date.now() >= end) return reject(new Error('waitFor condition timed out.'));" +
        " setTimeout(check, 100); }; check(); })",
      { timeoutMs: timeoutMs + 5000 },
    );
  }
  const fields = typeof condition === "string" ? { text: condition } : { ...condition };
  if (fields.target !== undefined) fields.target = __target(fields.target);
  return step(__with({ action: "wait_for", ...fields }, options));
};
globalThis.evaluate = (expression, options) =>
  step(__with({
    action: "evaluate",
    expression: typeof expression === "function" ? "(" + String(expression) + ")()" : expression,
  }, options));
globalThis.snapshot = () => step({ action: "snapshot" });
globalThis.log = (...values) =>
  __log(values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
globalThis.console = { log, info: log, warn: log, error: log };
`;

let quickJsModule: Promise<QuickJSWASMModule> | undefined;

// The module compiles its WebAssembly once per process; each script gets its own runtime.
const loadQuickJs = () =>
  browserCall(() => {
    quickJsModule ??= newQuickJSWASMModuleFromVariant(releaseSyncVariant).catch((error: unknown) => {
      quickJsModule = undefined;
      throw error;
    });
    return quickJsModule;
  });

type SandboxState =
  | { kind: "fulfilled"; value: unknown }
  | { kind: "rejected"; error: unknown }
  | { kind: "step"; request: string; deferred: QuickJSDeferredPromise }
  | { kind: "stuck" };

/** One QuickJS runtime and context with no host access except the `__step` and `__log` functions. */
class BrowserScriptSandbox {
  readonly #runtime: QuickJSRuntime;
  readonly #context: QuickJSContext;
  readonly #requests: { request: string; deferred: QuickJSDeferredPromise }[] = [];
  readonly #deferreds: QuickJSDeferredPromise[] = [];
  readonly log: string[] = [];
  #logChars = 0;
  #promise: QuickJSHandle | undefined;

  constructor(module: QuickJSWASMModule, deadline: number) {
    this.#runtime = module.newRuntime();
    this.#runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    this.#runtime.setMaxStackSize(STACK_LIMIT_BYTES);
    this.#runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
    this.#context = this.#runtime.newContext();
    const context = this.#context;
    const step = context.newFunction("__step", (request) => {
      const deferred = context.newPromise();
      this.#deferreds.push(deferred);
      this.#requests.push({ request: context.getString(request), deferred });
      return deferred.handle;
    });
    context.setProp(context.global, "__step", step);
    step.dispose();
    const log = context.newFunction("__log", (line) => {
      this.#append(context.getString(line));
    });
    context.setProp(context.global, "__log", log);
    log.dispose();
  }

  /** Starts the script. Returns the error of a script that does not parse or fails at once. */
  start(script: string): unknown {
    const prelude = this.#context.evalCode(PRELUDE, "prelude.js");
    if (prelude.error) {
      const error = this.#context.dump(prelude.error);
      prelude.error.dispose();
      return error;
    }
    prelude.value.dispose();
    const started = this.#context.evalCode(`(async () => {\n${script}\n})()`, "script.js");
    if (started.error) {
      const error = this.#context.dump(started.error);
      started.error.dispose();
      return error;
    }
    this.#promise = started.value;
    return undefined;
  }

  /** Runs the script until it ends or waits for a step. */
  advance(): SandboxState {
    const jobs = this.#runtime.executePendingJobs();
    if (jobs.error) {
      const error = this.#context.dump(jobs.error);
      jobs.error.dispose();
      return { kind: "rejected", error };
    }
    if (!this.#promise) return { kind: "stuck" };
    const state = this.#context.getPromiseState(this.#promise);
    if (state.type === "fulfilled") {
      const value = this.#context.dump(state.value);
      state.value.dispose();
      return { kind: "fulfilled", value };
    }
    if (state.type === "rejected") {
      const error = this.#context.dump(state.error);
      state.error.dispose();
      return { kind: "rejected", error };
    }
    const next = this.#requests.shift();
    return next ? { kind: "step", ...next } : { kind: "stuck" };
  }

  resolve(deferred: QuickJSDeferredPromise, value: BrowserStepOutcome & { status: "ok" }): void {
    if (value.value === undefined) {
      deferred.resolve();
      return;
    }
    const handle = this.#context.newString(JSON.stringify(value.value));
    deferred.resolve(handle);
    handle.dispose();
  }

  reject(deferred: QuickJSDeferredPromise, message: string): void {
    const handle = this.#context.newError(message);
    deferred.reject(handle);
    handle.dispose();
  }

  dispose(): void {
    for (const deferred of this.#deferreds) if (deferred.alive) deferred.dispose();
    this.#promise?.dispose();
    this.#context.dispose();
    this.#runtime.dispose();
  }

  #append(line: string): void {
    if (this.log.length >= LOG_LIMIT_ENTRIES || this.#logChars >= LOG_LIMIT_CHARS) return;
    const kept = line.slice(0, LOG_LIMIT_CHARS - this.#logChars);
    this.#logChars += kept.length;
    this.log.push(kept);
  }
}

function errorText(error: unknown): string {
  const text =
    typeof error === "object" && error !== null && "message" in error
      ? `${"name" in error ? String(error.name) : "Error"}: ${String(error.message)}`
      : String(error);
  return text.slice(0, ERROR_LIMIT_CHARS);
}

/**
 * Runs an agent's script in a QuickJS WebAssembly sandbox. The script has no network, files, modules,
 * timers, or process; it can only ask the host to run browser steps, one at a time. Memory, stack,
 * total time, and step count are limited.
 */
export const runBrowserScript = Effect.fn("BrowserScript.run")(function* (options: BrowserScriptOptions) {
  const module = yield* loadQuickJs();
  const deadline = Date.now() + options.timeoutMs;
  return yield* Effect.acquireUseRelease(
    browserSync(() => new BrowserScriptSandbox(module, deadline)),
    (sandbox) =>
      Effect.gen(function* () {
        let steps = 0;
        const result = (
          status: BrowserScriptResult["status"],
          detail: { value?: BrowserJsonValue; error?: string } = {},
        ): BrowserScriptResult => ({
          status,
          ...detail,
          steps,
          ...(sandbox.log.length > 0 ? { log: sandbox.log } : {}),
        });
        const timedOut = () => result("timeout", { error: "The script ran past its timeout." });
        const startError = sandbox.start(options.script);
        if (startError !== undefined) return result("failed", { error: errorText(startError) });
        for (;;) {
          const state = sandbox.advance();
          if (state.kind === "fulfilled") {
            const text = JSON.stringify(state.value);
            if (text === undefined) return result("completed");
            if (text.length > RESULT_LIMIT_CHARS)
              return result("failed", { error: "The script result is larger than 64 KB. Return less data." });
            const value: BrowserJsonValue = JSON.parse(text);
            return result("completed", { value });
          }
          if (state.kind === "rejected")
            return Date.now() >= deadline ? timedOut() : result("failed", { error: errorText(state.error) });
          if (state.kind === "stuck")
            return result("failed", {
              error: "The script waits for a promise that no helper settles. Await only the browser helpers.",
            });
          if (steps >= options.maxSteps)
            return result("step_limit", { error: `The script asked for more than ${options.maxSteps} steps.` });
          steps += 1;
          const parsed = Result.try(() => parseBrowserStep(JSON.parse(state.request)));
          if (Result.isFailure(parsed)) {
            sandbox.reject(state.deferred, errorText(parsed.failure));
            continue;
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) return timedOut();
          const outcome = yield* Effect.result(withTimeout(options.runStep(parsed.success), remaining, "timeout"));
          if (Result.isFailure(outcome)) return timedOut();
          switch (outcome.success.status) {
            case "ok":
              sandbox.resolve(state.deferred, outcome.success);
              break;
            case "error":
              sandbox.reject(state.deferred, outcome.success.error);
              break;
            case "user_control":
              return result("user_control", {
                error: BROWSER_SCRIPT_USER_CONTROL_ERROR,
              });
            case "tab_closed":
              return result("tab_closed", { error: "A step closed the tab." });
          }
        }
      }),
    (sandbox) => Effect.sync(() => sandbox.dispose()),
  );
});
