import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

const REF = /^(\d+):[^:\s]+:\d+$/u;
const REF_LINE = /^(\d+:[^:\s]+:\d+)\s/u;
const ROLE_LINE = /^([a-z]+) "(.+)"$/u;
const CSS_PREFIX = /^css:?\s+(.+)$/su;

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

const SECRET_TOOLS = new Set([
  "submit_secret",
  "fill_card",
  "list_logins",
  "list_vault_items",
  "save_vault_item",
  "request_vault_item",
  "delete_vault_item",
  "request_link_payment",
  "request_near_payment",
]);

const SNAKE_CASE = /_([a-z])/gu;

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

const CSS_NTH = /^(.+?)\s*>>\s*nth=(\d+)$/su;

function repairTarget(value: unknown): DynamicRecord | undefined {
  const target = targetForm(value);
  if (target?.kind !== "css" || typeof target.selector !== "string" || target.nth !== undefined) return target;
  const nth = CSS_NTH.exec(target.selector.trim());
  return nth ? { ...target, selector: nth[1], nth: Number(nth[2]) } : target;
}

function targetForm(value: unknown): DynamicRecord | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (REF.test(text)) return refTarget(text);
    const line = REF_LINE.exec(text)?.[1];
    if (line !== undefined) return refTarget(line);
    const css = CSS_PREFIX.exec(text)?.[1];
    if (css !== undefined) return { kind: "css", selector: css };
    const role = ROLE_LINE.exec(text);
    if (role) return { kind: "role", role: role[1], name: role[2] };
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
    const ref = REF_LINE.exec(target.ref.trim())?.[1] ?? target.ref.trim();
    if (REF.test(ref)) target = { ...target, ref, revision: target.revision ?? Number(ref.split(":", 1)[0]) };
  }
  if (target.kind === "role" && isDynamicRecord(target.name)) {
    const { name, exact } = target.name;
    target = { ...target, name, ...(exact === undefined ? {} : { exact }) };
  }
  return target;
}

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
    const { replace, clear, ...rest } = args;
    const flag = typeof replace === "boolean" ? replace : clear;
    if (typeof flag === "boolean") args = { ...rest, mode: flag ? "replace" : "append" };
  }
  if (tool === "wait_for") {
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

export function repairBrowserToolInput(tool: string, value: unknown): { value: unknown } {
  if (!isDynamicRecord(value) || SECRET_TOOLS.has(tool)) return { value };
  let args = value;
  const wrapped = args.arguments;
  if (
    isDynamicRecord(wrapped) &&
    typeof args.name === "string" &&
    (args.name === tool || args.name.endsWith(`.${tool}`)) &&
    Object.keys(args).every((key) => key === "name" || key === "tool" || key === "arguments")
  )
    args = wrapped;
  if (Object.keys(args).some((key) => key.includes("_")))
    args = Object.fromEntries(
      Object.entries(args).map(([key, value]) => {
        const camel = key.replace(SNAKE_CASE, (_, letter: string) => letter.toUpperCase());
        return [camel !== key && args[camel] === undefined ? camel : key, value];
      }),
    );
  if (tool === "open" && args.tabId !== undefined) {
    const { tabId: _tabId, ...rest } = args;
    args = rest;
  }
  return { value: repairFields(tool, args) };
}

export function repairBrowserStep(step: DynamicRecord): DynamicRecord {
  return typeof step.action === "string" ? repairFields(step.action, step) : step;
}
