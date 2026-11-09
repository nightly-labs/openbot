import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

// Agents write some browser tool arguments in forms that the schemas do not take, and each refusal
// costs a turn. These are the forms that agent transcripts show again and again. Each rewrite keeps
// the meaning that the call states; a form that can mean two things stays a refusal.

/** A snapshot ref: `<revision>:<frame>:<node>`. Its first part is the revision of the snapshot that made it. */
const REF = /^(\d+):[^:\s]+:\d+$/u;
/** A snapshot line, `<ref> <role> "<name>"`, copied as a target: the ref decides. */
const REF_LINE = /^(\d+:[^:\s]+:\d+)\s/u;
/** `link "Travel"`: the role and the name of a snapshot line, without the ref. */
const ROLE_LINE = /^([a-z]+) "(.+)"$/u;
/** `css #main`, `css: #main`. */
const CSS_PREFIX = /^css:?\s+(.+)$/su;

/** Wait states from Playwright and Puppeteer. A target wait already waits until the element has a box. */
const WAIT_STATES: Readonly<Record<string, string>> = {
  networkidle: "dom-quiet",
  networkidle0: "dom-quiet",
  networkidle2: "dom-quiet",
  idle: "dom-quiet",
  quiet: "dom-quiet",
  complete: "load",
  interactive: "domcontentloaded",
};
const TARGET_WAIT_STATES = new Set(["visible", "attached"]);

/** `tab_id`, as Python libraries name it. No browser tool field has an underscore. */
const SNAKE_CASE = /_([a-z])/gu;

/** Tools and steps that act on one `target`. */
const TARGET_TOOLS = new Set([
  "click",
  "type",
  "press",
  "hover",
  "scroll",
  "select_option",
  "set_checked",
  "upload_files",
  "wait_for",
]);

function refTarget(ref: string): DynamicRecord {
  return { kind: "ref", ref, revision: Number(ref.split(":", 1)[0]) };
}

/** The target that `value` names, or undefined when it is no form that this file knows. */
function repairTarget(value: unknown): DynamicRecord | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (REF.test(text)) return refTarget(text);
    const line = REF_LINE.exec(text)?.[1];
    if (line !== undefined) return refTarget(line);
    const css = CSS_PREFIX.exec(text)?.[1];
    if (css !== undefined) return { kind: "css", selector: css };
    const role = ROLE_LINE.exec(text);
    if (role) return { kind: "role", role: role[1], name: role[2] };
    // The run_script helpers read a string target as a CSS selector, so a tool does the same.
    return { kind: "css", selector: text };
  }
  if (!isDynamicRecord(value)) return undefined;
  let target: DynamicRecord = value;
  if (target.kind === undefined) {
    const { css, selector, ...rest } = target;
    if (typeof target.ref === "string") target = { ...target, kind: "ref" };
    else if (typeof (selector ?? css) === "string") target = { ...rest, kind: "css", selector: selector ?? css };
    else if (typeof target.role === "string") target = { ...target, kind: "role" };
    else if (typeof target.text === "string") target = { ...target, kind: "text" };
    else if (typeof target.x === "number" && typeof target.y === "number") target = { ...target, kind: "point" };
  }
  if (target.kind === "ref" && typeof target.ref === "string") {
    // A whole snapshot line in ref: its first part is the ref.
    const ref = REF_LINE.exec(target.ref.trim())?.[1] ?? target.ref.trim();
    if (REF.test(ref)) target = { ...target, ref, revision: target.revision ?? Number(ref.split(":", 1)[0]) };
  }
  // role("button", { name: "Start", exact: true }), as Playwright writes it, in a target object.
  if (target.kind === "role" && isDynamicRecord(target.name)) {
    const { name, exact } = target.name;
    target = { ...target, name, ...(exact === undefined ? {} : { exact }) };
  }
  return target;
}

/** Repairs the fields of one tool call or `run_script` step. `tool` is the tool name or the step action. */
function repairFields(tool: string, fields: DynamicRecord): DynamicRecord {
  let args: DynamicRecord = fields;
  if (TARGET_TOOLS.has(tool) && args.target === undefined && typeof args.ref === "string") {
    const { ref, ...rest } = args;
    args = { ...rest, target: ref };
  }
  for (const key of ["target", "source", "submitTarget"])
    if (args[key] !== undefined) args = { ...args, [key]: repairTarget(args[key]) ?? args[key] };
  const { targets } = args;
  if (Array.isArray(targets)) args = { ...args, targets: targets.map((value) => repairTarget(value) ?? value) };
  else if (isDynamicRecord(targets))
    args = {
      ...args,
      targets: Object.fromEntries(Object.entries(targets).map(([key, value]) => [key, repairTarget(value) ?? value])),
    };
  if (tool === "type" && args.mode === undefined) {
    // { replace: true } and { clear: true }: clear the field first, as Playwright's fill does.
    const { replace, clear, ...rest } = args;
    if (typeof replace === "boolean" || typeof clear === "boolean")
      args = { ...rest, ...(replace === true || clear === true ? { mode: "replace" } : {}) };
  }
  if (tool === "wait_for") {
    // wait_for always returns a fresh snapshot. { condition: "text", text: "Done" }: the field says it.
    const { snapshot: _snapshot, state, condition, ...named } = args;
    const redundant = typeof condition === "string" && named[condition] !== undefined;
    const rest = redundant || condition === undefined ? named : { ...named, condition };
    const mapped = typeof state === "string" ? (WAIT_STATES[state] ?? state) : state;
    const keep = mapped !== undefined && !(rest.target !== undefined && TARGET_WAIT_STATES.has(String(mapped)));
    args = { ...rest, ...(keep ? { state: mapped } : {}) };
  }
  if (tool === "fill_fields" && Array.isArray(args.fields)) {
    const list = args.fields.map((field: unknown) => {
      if (!isDynamicRecord(field) || field.text !== undefined || typeof field.value !== "string") return field;
      const { value, ...rest } = field;
      return { ...rest, text: value };
    });
    args = { ...args, fields: list };
    // Each ref names the snapshot that made it; the call needs one snapshot for all its fields.
    if (args.revision === undefined) {
      const revisions = new Set(
        list.map((field) =>
          isDynamicRecord(field) && typeof field.ref === "string" ? REF.exec(field.ref)?.[1] : undefined,
        ),
      );
      const [only] = revisions;
      if (revisions.size === 1 && only !== undefined) args = { ...args, revision: Number(only) };
    }
  }
  return args;
}

/**
 * Rewrites the arguments of a browser tool call to the form that its schema takes. The result is
 * still untrusted: the schema decodes it after this.
 */
export function repairBrowserToolInput(tool: string, value: unknown): { tool: string; value: unknown } {
  if (!isDynamicRecord(value)) return { tool, value };
  let args = value;
  // { name: "openbot_browser.click", arguments: { ... } }: the call written inside the arguments.
  const wrapped = args.arguments;
  if (
    isDynamicRecord(wrapped) &&
    typeof args.name === "string" &&
    (args.name === tool || args.name.endsWith(`.${tool}`)) &&
    Object.keys(args).every((key) => key === "name" || key === "tool" || key === "arguments")
  )
    args = wrapped;
  // { tab_id }: the field in camel case, unless the call also gives that.
  if (Object.keys(args).some((key) => key.includes("_")))
    args = Object.fromEntries(
      Object.entries(args).map(([key, value]) => {
        const camel = key.replace(SNAKE_CASE, (_, letter: string) => letter.toUpperCase());
        return [camel !== key && args[camel] === undefined ? camel : key, value];
      }),
    );
  // open with a tabId: the agent asks to load the URL in that tab, which navigate does.
  if (tool === "open" && typeof args.tabId === "string" && typeof args.url === "string")
    return { tool: "navigate", value: { tabId: args.tabId, url: args.url } };
  return { tool, value: repairFields(tool, args) };
}

/** Rewrites one `run_script` step to the form that the step schema takes. */
export function repairBrowserStep(step: DynamicRecord): DynamicRecord {
  return typeof step.action === "string" ? repairFields(step.action, step) : step;
}
