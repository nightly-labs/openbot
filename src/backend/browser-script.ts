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
import type { DialogTabResult } from "./browser-tab-operations";
import { BROWSER_SCRIPT_MAX_SLEEP_MS, type BrowserStep, parseBrowserStep } from "./browser-tools";
import { BROWSER_VALUE_TOO_LARGE } from "./model-text-limit";
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
  | { status: "tab_closed" }
  | { status: "page_crashed" }
  | { status: "dialog"; dialog: DialogTabResult };

export const BROWSER_PAGE_CRASH_RELOADED =
  "The page crashed and OpenBot loaded it again. Refs from before the crash are stale.";

export const BROWSER_PAGE_CRASH_KEPT = "The page crashed. OpenBot did not reload it.";

export const BROWSER_SCRIPT_USER_CONTROL_ERROR =
  "A person took control of the tab. Wait for the release, then take a fresh snapshot.";

export interface BrowserScriptResult {
  status: "completed" | "failed" | "timeout" | "step_limit" | "user_control" | "tab_closed" | "page_crashed" | "dialog";
  value?: BrowserJsonValue;
  error?: string;
  /** The page dialog that a step opened. The script stops, and the agent answers it with `handle_dialog`. */
  dialog?: DialogTabResult["dialog"];
  steps: number;
  log?: string[];
}

interface BrowserScriptOptions {
  script: string;
  timeoutMs: number;
  maxSteps: number;
  /** Runs one step on the tab. A failed step is an outcome, not an error. */
  runStep: (step: BrowserStep) => Effect.Effect<BrowserStepOutcome>;
  /** The tab's address now, as the result of a script shows it, or undefined when the tab is gone. */
  currentUrl: () => string | undefined;
}

// The helpers the script awaits. Each one sends a single step through `__step`, which the host runs
// with every check of the matching tool. They live in the sandbox, so a script can change them only
// for itself.
const PRELUDE = `
// Models often pass timeout, as other browser libraries name it, or the timeout as a bare number.
const __with = (step, options) => {
  // A string, such as waitFor(fn, "present"), names no option.
  const { timeout, ...rest } =
    typeof options === "number" ? { timeoutMs: options } : options !== null && typeof options === "object" ? options : {};
  return { ...step, ...(timeout === undefined || rest.timeoutMs !== undefined ? {} : { timeoutMs: timeout }), ...rest };
};
// waitFor("text", "Hello") and waitFor("selector", "#done"): the forms that models write by mistake.
const __waitFields = { text: "text", url: "url", state: "state", selector: "target", css: "target" };
// waitFor("Results", "load"): a second word that only says to wait on the page.
const __waitWords = new Set(["page", "load", "domcontentloaded", "networkidle"]);
// waitFor("#results", "present") waits for the element; waitFor("Results", "appears") for the text.
// A bare word, such as "table", can be either, so only a selector with #, ., [, : or > is an element.
const __presenceWords = new Set(["present", "exists", "appear", "appears"]);
const __selectorLike = (value) => /^(?:[#.[*]|[a-z][\\w-]*(?:[#.[:]|\\s*[>~+]))/.test(value);
// css("li").nth(2) and css("li").first(), as Playwright writes them. The methods are not enumerable,
// so the target that a step sends has only its fields.
const __target = (target) => {
  if (target.nth !== undefined) return target;
  for (const [name, pick] of [["nth", (index) => index], ["first", () => 0]])
    Object.defineProperty(target, name, { value: (index) => ({ ...target, nth: pick(index) }), configurable: true });
  return target;
};
const __nth = (options) => (options !== null && typeof options === "object" && options.nth !== undefined ? { nth: options.nth } : {});
globalThis.css = (selector, options) =>
  __target({ kind: "css", selector, ...(typeof options === "number" ? { nth: options } : __nth(options)) });
globalThis.role = (role, name, exact) => {
  const nth = { ...__nth(name), ...__nth(exact) };
  // role("button", { name: "Start", exact: true }), as Playwright writes it.
  if (name !== null && typeof name === "object") {
    exact = name.exact ?? exact;
    name = name.name;
  }
  // role("textbox", "Username", { exact: true })
  if (exact !== null && typeof exact === "object") exact = exact.exact;
  return __target({ kind: "role", role, ...(name === undefined ? {} : { name }), ...(exact === undefined ? {} : { exact }), ...nth });
};
globalThis.text = (text, exact) => {
  const nth = __nth(exact);
  // text("Delete", { exact: true, nth: 1 })
  if (exact !== null && typeof exact === "object") exact = exact.exact;
  return __target({ kind: "text", text, ...(exact === undefined ? {} : { exact }), ...nth });
};
globalThis.step = async (step) => {
  const result = await __step(JSON.stringify(step));
  return result === undefined ? undefined : JSON.parse(result);
};
globalThis.navigate = (url, options) =>
  step(__with(
    typeof url === "string" || url instanceof URL ? { action: "navigate", url: String(url) } : { action: "navigate", ...url },
    options,
  ));
globalThis.click = (target, options) => step(__with({ action: "click", target }, options));
globalThis.type = (target, text, options) =>
  step(__with({ action: "type", ...(target == null ? {} : { target }), text }, options));
globalThis.press = (key, target, options) =>
  step(__with({ action: "press", key, ...(target == null ? {} : { target }) }, options));
globalThis.hover = (target, options) => step(__with({ action: "hover", target }, options));
globalThis.scroll = (deltaY, target, options) =>
  step(__with({ action: "scroll", deltaY, ...(target == null ? {} : { target }) }, options));
globalThis.selectOption = (target, values, options) =>
  step(__with({ action: "select_option", target, values: [].concat(values) }, options));
globalThis.setChecked = (target, checked = true, options) =>
  step(__with({ action: "set_checked", target, checked }, options));
globalThis.sleep = (ms) =>
  step({ action: "sleep", ms: Math.max(0, Math.min(Math.round(Number(ms) || 0), ${BROWSER_SCRIPT_MAX_SLEEP_MS})) });
let __timer = 0;
const __cancelled = new Set();
globalThis.setTimeout = (callback, ms, ...args) => {
  const id = ++__timer;
  sleep(ms).then(() => { if (!__cancelled.delete(id)) callback(...args); });
  return id;
};
globalThis.clearTimeout = (id) => { __cancelled.add(id); };
globalThis.waitFor = (condition, options, more) => {
  if (typeof condition === "number") return sleep(condition);
  if (typeof condition === "string" && typeof options === "string") {
    // waitFor("#done", "visible"): a selector and the state of its element.
    if (__waitFields[condition] === undefined && (options === "visible" || options === "attached"))
      return waitFor({ target: css(condition) }, more);
    // waitFor("#spinner", "hidden"): the element goes away or stops showing.
    if (__waitFields[condition] === undefined && (options === "hidden" || options === "detached"))
      return __pollPage(
        "() => { const element = document.querySelector(" + JSON.stringify(condition) + ");" +
          " return !element || element.getClientRects().length === 0 || getComputedStyle(element).visibility === 'hidden'; }",
        more,
      );
    if (__waitFields[condition] === undefined && __presenceWords.has(options.toLowerCase()))
      return waitFor(__selectorLike(condition) ? { target: css(condition) } : condition, more);
    if (__waitFields[condition] === undefined && __waitWords.has(options.toLowerCase())) return waitFor(condition, more);
    // waitFor("Hello", "text"): the value first, the field second.
    const [name, value] = __waitFields[condition] === undefined ? [options, condition] : [condition, options];
    const field = __waitFields[name];
    if (field === undefined) throw new Error('waitFor takes waitFor("text"), waitFor(selector, "visible" | "hidden"), waitFor({ text | url | target | state }), or waitFor(() => condition).');
    return waitFor(field === "target" ? { target: css(value) } : { [field]: value }, more);
  }
  // A page function is polled in the page until it returns a truthy value, as one evaluate step.
  if (typeof condition === "function") {
    const { timeoutMs: requested = 10000 } = __with({}, options);
    const timeoutMs = Math.min(requested, 25000);
    // A function that calls the helpers, such as evaluate, is written for this sandbox, not for the
    // page: poll it here, once a second, so a 25-second wait takes about 25 steps. The page's own
    // document.evaluate is an XPath call, not the helper.
    if (/(?<![.\\w$])(?:evaluate|snapshot|step)\\s*\\(/.test(String(condition)))
      return (async () => {
        const end = Date.now() + timeoutMs;
        while (!(await condition())) {
          if (Date.now() >= end) throw new Error("waitFor condition timed out.");
          await sleep(1000);
        }
        return true;
      })();
    return __pollPage(String(condition), options);
  }
  // waitFor(role("button", "Start")): a target object is the element to wait for.
  const fields = typeof condition === "string" ? { text: condition }
    : typeof condition?.kind === "string" ? { target: condition } : { ...condition };
  if (fields.selector !== undefined) {
    fields.target = fields.selector;
    delete fields.selector;
  }
  return step({ action: "wait_for", ...__with(fields, options) });
};
// Polls a page function, given as its source, in the page until it returns a truthy value.
const __pollPage = (source, options) => {
  const { timeoutMs: requested = 10000 } = __with({}, options);
  const timeoutMs = Math.min(requested, 25000);
  return evaluate(
    "new Promise((resolve, reject) => { const end = Date.now() + " + timeoutMs + "; const check = async () => {" +
      " try { if (await (" + source + ")()) return resolve(true); } catch (error) { return reject(error); }" +
      " if (Date.now() >= end) return reject(new Error('waitFor condition timed out.'));" +
      " setTimeout(check, 100); }; check(); })",
    { timeoutMs: timeoutMs + 5000 },
  );
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
// Scripts resolve the links that they read with new URL(href, base). The host parses each URL, and
// each URL field setter runs on the host, so the results are those of a browser.
const __parseUrl = (input, base, field, value) => {
  const parsed = __url(String(input), base === undefined ? undefined : String(base), field, value === undefined ? undefined : String(value));
  if (parsed === undefined) throw new TypeError("Invalid URL: " + String(field === undefined ? input : value));
  return JSON.parse(parsed);
};
const __formEncode = (text) =>
  encodeURIComponent(text).replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
const __formDecode = (text) => {
  const spaced = text.replace(/\\+/g, " ");
  try { return decodeURIComponent(spaced); } catch { return spaced; }
};
const __formParse = (text) =>
  text.replace(/^\\?/, "").split("&").filter((part) => part !== "").map((part) => {
    const at = part.indexOf("=");
    return at < 0 ? [__formDecode(part), ""] : [__formDecode(part.slice(0, at)), __formDecode(part.slice(at + 1))];
  });
const __paramEntries = new WeakMap();
const __paramOwners = new WeakMap();
const __urlStates = new WeakMap();
const __urlParams = new WeakMap();
const __paramsChanged = (params) => {
  const owner = __paramOwners.get(params);
  if (owner) owner.search = params.toString();
};
globalThis.URLSearchParams = class URLSearchParams {
  constructor(init = "") {
    __paramEntries.set(this,
      typeof init === "string" ? __formParse(init)
      : init instanceof URLSearchParams ? [...init]
      : Array.isArray(init) ? init.map(([name, value]) => [String(name), String(value)])
      : init !== null && typeof init === "object" ? Object.entries(init).map(([name, value]) => [name, String(value)])
      : __formParse(String(init)));
  }
  get size() { return __paramEntries.get(this).length; }
  append(name, value) { __paramEntries.get(this).push([String(name), String(value)]); __paramsChanged(this); }
  delete(name) { __paramEntries.set(this, __paramEntries.get(this).filter(([key]) => key !== String(name))); __paramsChanged(this); }
  get(name) { const found = __paramEntries.get(this).find(([key]) => key === String(name)); return found ? found[1] : null; }
  getAll(name) { return __paramEntries.get(this).filter(([key]) => key === String(name)).map(([, value]) => value); }
  has(name) { return __paramEntries.get(this).some(([key]) => key === String(name)); }
  set(name, value) {
    const entries = __paramEntries.get(this);
    const at = entries.findIndex(([key]) => key === String(name));
    if (at < 0) entries.push([String(name), String(value)]);
    else __paramEntries.set(this, [...entries.slice(0, at + 1).map((entry, index) => (index === at ? [entry[0], String(value)] : entry)), ...entries.slice(at + 1).filter(([key]) => key !== String(name))]);
    __paramsChanged(this);
  }
  sort() { __paramEntries.get(this).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); __paramsChanged(this); }
  forEach(callback, thisArg) { for (const [name, value] of this) callback.call(thisArg, value, name, this); }
  keys() { return __paramEntries.get(this).map(([name]) => name)[Symbol.iterator](); }
  values() { return __paramEntries.get(this).map(([, value]) => value)[Symbol.iterator](); }
  entries() { return __paramEntries.get(this).map(([name, value]) => [name, value])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  toString() { return __paramEntries.get(this).map(([name, value]) => __formEncode(name) + "=" + __formEncode(value)).join("&"); }
};
const __setUrl = (url, state) => {
  __urlStates.set(url, state);
  __paramEntries.set(__urlParams.get(url), __formParse(state.search));
};
globalThis.URL = class URL {
  constructor(input, base) {
    const params = new URLSearchParams();
    __paramOwners.set(params, this);
    __urlParams.set(this, params);
    __setUrl(this, __parseUrl(input, base));
  }
  static canParse(input, base) {
    try { __parseUrl(input, base); return true; } catch { return false; }
  }
  get origin() { return __urlStates.get(this).origin; }
  get searchParams() { return __urlParams.get(this); }
  toString() { return this.href; }
  toJSON() { return this.href; }
};
const __urlFields = ["href", "protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash"];
for (const field of __urlFields) {
  Object.defineProperty(URL.prototype, field, {
    get() { return __urlStates.get(this)[field]; },
    set(value) { __setUrl(this, __parseUrl(this.href, undefined, field, value)); },
  });
}
// Scripts read the tab address as location.href, as in the page, to resolve the links that they read.
// It is read-only: a navigation is a step, so a script calls navigate(url).
const __readOnlyLocation = () => {
  throw new TypeError("location is read-only in the script: call await navigate(url).");
};
const __tabUrl = () => {
  const href = __location();
  if (href === undefined) throw new Error("The tab has no address.");
  return new URL(href);
};
const __locationObject = { assign: __readOnlyLocation, replace: __readOnlyLocation, reload: __readOnlyLocation };
for (const field of [...__urlFields, "origin"]) {
  Object.defineProperty(__locationObject, field, { get: () => __tabUrl()[field], set: __readOnlyLocation });
}
__locationObject.toString = () => __tabUrl().href;
Object.defineProperty(globalThis, "location", { get: () => __locationObject, set: __readOnlyLocation });
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

/** One QuickJS runtime and context with no host access except the `__step`, `__log`, `__url`, and `__location` functions. */
class BrowserScriptSandbox {
  readonly #runtime: QuickJSRuntime;
  readonly #context: QuickJSContext;
  readonly #requests: { request: string; deferred: QuickJSDeferredPromise }[] = [];
  readonly #deferreds: QuickJSDeferredPromise[] = [];
  readonly log: string[] = [];
  #logChars = 0;
  #promise: QuickJSHandle | undefined;

  constructor(module: QuickJSWASMModule, deadline: number, currentUrl: () => string | undefined) {
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
    const url = context.newFunction("__url", (input, base, field, value) => {
      const text = (handle: QuickJSHandle | undefined) =>
        handle !== undefined && context.typeof(handle) === "string" ? context.getString(handle) : undefined;
      const parsed = scriptUrl(text(input) ?? "", text(base), text(field), text(value));
      return parsed === undefined ? context.undefined : context.newString(parsed);
    });
    context.setProp(context.global, "__url", url);
    url.dispose();
    const location = context.newFunction("__location", () => {
      const href = currentUrl();
      return href === undefined ? context.undefined : context.newString(href);
    });
    context.setProp(context.global, "__location", location);
    location.dispose();
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

const URL_FIELDS = [
  "href",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;

/** The fields of a script's URL as JSON, after the setter of `field`, or undefined when the URL is not valid. */
function scriptUrl(input: string, base: string | undefined, field: string | undefined, value: string | undefined) {
  let url: URL;
  try {
    url = new URL(input, base);
    const setter = URL_FIELDS.find((name) => name === field);
    if (setter !== undefined && value !== undefined) url[setter] = value;
  } catch {
    return undefined;
  }
  const { href, origin, protocol, username, password, host, hostname, port, pathname, search, hash } = url;
  return JSON.stringify({ href, origin, protocol, username, password, host, hostname, port, pathname, search, hash });
}

// The page globals and page objects of other browser libraries, which the script does not have.
const PAGE_GLOBAL =
  /^ReferenceError: '?(?:document|window|navigator|localStorage|sessionStorage|fetch|page|browser|\$\$?)'? is not defined/u;
const PAGE_GLOBAL_HINT =
  " The script runs in a sandbox, not in the page: read the page in evaluate(() => ...), and call the helpers, such as click(target), directly.";

// The tool names of the helpers, which a model wrote as script calls, as in wait_for(...).
const SNAKE_HELPER = /^ReferenceError: '?(?:wait_for|select_option|set_checked)'? is not defined/u;
const SNAKE_HELPER_HINT = " The script helpers use camelCase: waitFor, selectOption, setChecked.";

function errorText(error: unknown): string {
  const text =
    typeof error === "object" && error !== null && "message" in error
      ? `${"name" in error ? String(error.name) : "Error"}: ${String(error.message)}`
      : String(error);
  const hint = PAGE_GLOBAL.test(text) ? PAGE_GLOBAL_HINT : SNAKE_HELPER.test(text) ? SNAKE_HELPER_HINT : "";
  return `${text}${hint}`.slice(0, ERROR_LIMIT_CHARS);
}

/**
 * Runs an agent's script in a QuickJS WebAssembly sandbox. The script has no network, files, modules, or
 * process; it can only ask the host to run browser steps, one at a time. A sleep or setTimeout is a host timer that
 * does not hold the steps after it. Memory, stack, total time, and step count are limited.
 */
export const runBrowserScript = Effect.fn("BrowserScript.run")(function* (options: BrowserScriptOptions) {
  const module = yield* loadQuickJs();
  const deadline = Date.now() + options.timeoutMs;
  return yield* Effect.acquireUseRelease(
    browserSync(() => new BrowserScriptSandbox(module, deadline, options.currentUrl)),
    (sandbox) =>
      Effect.gen(function* () {
        let steps = 0;
        const result = (
          status: BrowserScriptResult["status"],
          detail: Pick<BrowserScriptResult, "value" | "error" | "dialog"> = {},
        ): BrowserScriptResult => ({
          status,
          ...detail,
          steps,
          ...(sandbox.log.length > 0 ? { log: sandbox.log } : {}),
        });
        const timedOut = () => result("timeout", { error: "The script ran past its timeout." });
        const startError = sandbox.start(options.script);
        if (startError !== undefined) return result("failed", { error: errorText(startError) });
        // A sleep, and so a setTimeout, is a timer here and not a step: the steps after it run at once,
        // as they would next to a timer in a page.
        const timers: { due: number; deferred: QuickJSDeferredPromise }[] = [];
        const fireDueTimers = () => {
          const now = Date.now();
          for (const timer of timers.filter((item) => item.due <= now)) {
            timers.splice(timers.indexOf(timer), 1);
            sandbox.resolve(timer.deferred, { status: "ok" });
          }
        };
        for (;;) {
          fireDueTimers();
          const state = sandbox.advance();
          if (state.kind === "fulfilled") {
            const text = JSON.stringify(state.value);
            if (text === undefined) return result("completed");
            if (text.length > RESULT_LIMIT_CHARS)
              return result("failed", { error: `The script result is larger than 64 KB. ${BROWSER_VALUE_TOO_LARGE}` });
            const value: BrowserJsonValue = JSON.parse(text);
            return result("completed", { value });
          }
          if (state.kind === "rejected")
            return Date.now() >= deadline ? timedOut() : result("failed", { error: errorText(state.error) });
          if (state.kind === "stuck" && timers.length > 0) {
            const wait = Math.min(...timers.map((timer) => timer.due)) - Date.now();
            if (Date.now() + wait >= deadline) return timedOut();
            yield* Effect.sleep(Math.max(0, wait));
            continue;
          }
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
          if (parsed.success.action === "sleep") {
            timers.push({ due: Date.now() + parsed.success.ms, deferred: state.deferred });
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
            case "page_crashed":
              return result("page_crashed", { error: BROWSER_PAGE_CRASH_RELOADED });
            case "dialog":
              return result("dialog", {
                error: `A step opened a page dialog. ${outcome.success.dialog.note}`,
                dialog: outcome.success.dialog.dialog,
              });
          }
        }
      }),
    (sandbox) => Effect.sync(() => sandbox.dispose()),
  );
});
