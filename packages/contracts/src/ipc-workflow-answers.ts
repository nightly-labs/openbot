import type { WorkflowGraph, WorkflowNode, WorkflowNodeKind } from "./ipc-workflows";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

export const WORKFLOW_ANSWER_FIELD = "answer";
export const WORKFLOW_CHECK_FIELD = "check";
export const WORKFLOW_ANSWER_MAX_FIELDS = 20;
export type WorkflowAnswerType = "text" | "number" | "integer" | "yes/no" | "list" | "choice";

export interface WorkflowAnswerField {
  name: string;
  type: WorkflowAnswerType;
  labels: readonly string[];
  optional: boolean;
}

export type WorkflowAnswerValue = string | number | boolean | readonly string[];
export type WorkflowAnswer = Readonly<Record<string, WorkflowAnswerValue>>;

export type WorkflowAnswerSpecProblem =
  | { code: "name"; line: string }
  | { code: "type"; name: string; type: string }
  | { code: "labels"; name: string }
  | { code: "duplicate"; name: string }
  | { code: "many" };

export interface WorkflowAnswerSpec {
  fields: WorkflowAnswerField[];
  problems: WorkflowAnswerSpecProblem[];
}

const FIELD_NAME = /^(?!__)[A-Za-z_][A-Za-z0-9_]{0,39}$/u;
const TEMPLATE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/gu;
const TYPE_WORDS: Readonly<Record<string, WorkflowAnswerType>> = {
  text: "text",
  string: "text",
  number: "number",
  integer: "integer",
  int: "integer",
  float: "number",
  "yes/no": "yes/no",
  yesno: "yes/no",
  boolean: "yes/no",
  bool: "yes/no",
  list: "list",
  "list of text": "list",
  "text[]": "list",
  "string[]": "list",
  array: "list",
};

export function parseWorkflowAnswerSpec(text: string): WorkflowAnswerSpec {
  const fields: WorkflowAnswerField[] = [];
  const problems: WorkflowAnswerSpecProblem[] = [];
  const lines = text
    .split(/[\n;]/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const colon = line.indexOf(":");
    const rawName = (colon < 0 ? line : line.slice(0, colon)).trim();
    const optional = rawName.endsWith("?");
    const name = optional ? rawName.slice(0, -1).trim() : rawName;
    if (!FIELD_NAME.test(name)) {
      problems.push({ code: "name", line });
      continue;
    }
    if (fields.some((field) => field.name === name)) {
      problems.push({ code: "duplicate", name });
      continue;
    }
    const typeText = colon < 0 ? "text" : line.slice(colon + 1).trim();
    const parsed = answerType(typeText);
    if (parsed === null) {
      problems.push({ code: "type", name, type: typeText });
      continue;
    }
    if (parsed.type === "choice" && parsed.labels.length < 2) {
      problems.push({ code: "labels", name });
      continue;
    }
    fields.push({ name, optional, ...parsed });
  }
  if (fields.length > WORKFLOW_ANSWER_MAX_FIELDS) problems.push({ code: "many" });
  return { fields: fields.slice(0, WORKFLOW_ANSWER_MAX_FIELDS), problems };
}

function answerType(text: string): { type: WorkflowAnswerType; labels: readonly string[] } | null {
  const word = text.toLowerCase().replace(/\s+/gu, " ");
  const typeWord = word || "text";
  const known = Object.hasOwn(TYPE_WORDS, typeWord) ? TYPE_WORDS[typeWord] : undefined;
  if (known) return { type: known, labels: [] };
  const listed = word.startsWith("one of ") ? text.trim().slice("one of ".length) : text;
  const separator = listed.includes("|") ? "|" : word.startsWith("one of ") ? "," : null;
  if (separator === null) return null;
  const labels = [
    ...new Set(
      listed
        .split(separator)
        .map((label) => label.trim().replace(/^["']|["']$/gu, ""))
        .filter(Boolean),
    ),
  ];
  return { type: "choice", labels };
}

export function workflowAnswerFieldsOf(node: WorkflowNode): WorkflowAnswerField[] {
  if (!givesWorkflowAnswer(node)) return [];
  return parseWorkflowAnswerSpec(fieldString(node, WORKFLOW_ANSWER_FIELD)).fields;
}

export function canGiveWorkflowAnswer(node: Pick<WorkflowNode, "kind" | "fields">): boolean {
  return node.kind === "agent" || node.kind === "llm" || (node.kind === "trigger" && node.fields.trigger === "webhook");
}

function givesWorkflowAnswer(node: WorkflowNode): boolean {
  return canGiveWorkflowAnswer(node) && fieldString(node, WORKFLOW_ANSWER_FIELD).trim().length > 0;
}

function fieldString(node: Pick<WorkflowNode, "fields">, name: string): string {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
}

export function workflowAnswerInstruction(fields: readonly WorkflowAnswerField[]): string {
  return fields.map((field) => `- ${field.name}: ${typeHint(field)}${field.optional ? ", optional" : ""}`).join("\n");
}

function typeHint(field: WorkflowAnswerField): string {
  switch (field.type) {
    case "choice":
      return `one of ${field.labels.map((label) => JSON.stringify(label)).join(", ")}`;
    case "yes/no":
      return "true or false";
    case "list":
      return "list of text";
    default:
      return field.type;
  }
}

export type WorkflowAnswerValueProblem = {
  name: string;
  problem: "missing" | "type" | "label" | "unknown" | "json";
};

export type WorkflowAnswerExtraKeys = "refuse" | "refuseMiscased" | "ignore";

export function checkWorkflowAnswer(
  fields: readonly WorkflowAnswerField[],
  value: unknown,
  extraKeys: WorkflowAnswerExtraKeys = "ignore",
): { answer: WorkflowAnswer; problems: WorkflowAnswerValueProblem[] } {
  const record: DynamicRecord = isDynamicRecord(value) ? value : {};
  const entries: [string, WorkflowAnswerValue][] = [];
  const problems: WorkflowAnswerValueProblem[] = extraKeyProblems(fields, record, extraKeys);
  for (const field of fields) {
    const raw = Object.hasOwn(record, field.name) ? record[field.name] : undefined;
    const checked = raw === undefined || raw === null || raw === "" ? undefined : answerValue(field, raw);
    if (checked !== undefined && typeof checked === "object" && "problem" in checked)
      problems.push({ name: field.name, problem: checked.problem });
    else if (checked === undefined || isBlank(checked)) {
      if (!field.optional) problems.push({ name: field.name, problem: "missing" });
    } else entries.push([field.name, checked]);
  }
  return { answer: Object.fromEntries(entries), problems };
}

function extraKeyProblems(
  fields: readonly WorkflowAnswerField[],
  record: DynamicRecord,
  extraKeys: WorkflowAnswerExtraKeys,
): WorkflowAnswerValueProblem[] {
  if (extraKeys === "ignore") return [];
  const names = new Set(fields.map((field) => field.name));
  const folded = new Set(fields.map((field) => field.name.toLowerCase()));
  return Object.keys(record)
    .filter((key) => !names.has(key) && (extraKeys === "refuse" || folded.has(key.toLowerCase())))
    .map((key) => ({ name: key, problem: "unknown" }));
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

const isBlank = (value: WorkflowAnswerValue) => value === "" || (typeof value === "object" && value.length === 0);

function answerValue(field: WorkflowAnswerField, raw: unknown): WorkflowAnswerValue | { problem: "type" | "label" } {
  switch (field.type) {
    case "text":
      if (typeof raw === "string") return raw.trim();
      return typeof raw === "number" || typeof raw === "boolean" ? String(raw) : { problem: "type" };
    case "number":
    case "integer": {
      const number =
        typeof raw === "number" ? raw : typeof raw === "string" && DECIMAL.test(raw.trim()) ? Number(raw) : Number.NaN;
      const fits = field.type === "integer" ? Number.isSafeInteger(number) : Number.isFinite(number);
      return fits ? number : { problem: "type" };
    }
    case "yes/no": {
      if (typeof raw === "boolean") return raw;
      const word = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (word === "true" || word === "yes") return true;
      if (word === "false" || word === "no") return false;
      return { problem: "type" };
    }
    case "list": {
      if (!Array.isArray(raw)) return { problem: "type" };
      const items: unknown[] = raw;
      const texts = items.flatMap((item) =>
        typeof item === "string" ? [item.trim()] : typeof item === "number" ? [String(item)] : [],
      );
      return texts.length === items.length ? texts.filter(Boolean) : { problem: "type" };
    }
    case "choice": {
      if (typeof raw !== "string") return { problem: "type" };
      const word = raw.trim().toLowerCase();
      return field.labels.find((label) => label.toLowerCase() === word) ?? { problem: "label" };
    }
  }
}

export function workflowAnswerFixText(problems: readonly WorkflowAnswerValueProblem[]): string {
  return problems.map(valueProblemText).join("; ");
}

function valueProblemText({ name, problem }: WorkflowAnswerValueProblem): string {
  switch (problem) {
    case "missing":
      return `${name} is missing`;
    case "label":
      return `${name} is not one of the labels`;
    case "unknown":
      return `${name} is not one of the fields (names are case-sensitive)`;
    case "json":
      return "the reply has no JSON object";
    case "type":
      return `${name} has the wrong type`;
  }
}

export function lastJsonObject(text: string): DynamicRecord | null {
  let found: DynamicRecord | null = null;
  for (let start = text.indexOf("{"); start >= 0; ) {
    const end = balancedEnd(text, start);
    if (end < 0) {
      start = text.indexOf("{", start + 1);
      continue;
    }
    const parsed = parseRecord(text.slice(start, end + 1));
    if (parsed) found = parsed;
    start = text.indexOf("{", parsed ? end + 1 : start + 1);
  }
  return found;
}

function parseRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function workflowAnswerTemplateText(field: WorkflowAnswerField, value: WorkflowAnswerValue | undefined): string {
  if (value === undefined) return "";
  if (field.type === "text" || field.type === "list") return JSON.stringify(value);
  return workflowAnswerValueText(value);
}

export function workflowAnswerValueText(value: WorkflowAnswerValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return value.join(", ");
  return String(value);
}

export function workflowAnswerLines(answer: WorkflowAnswer): string {
  return Object.entries(answer)
    .map(([name, value]) => `${name}: ${workflowAnswerValueText(value)}`)
    .join("\n");
}

export function workflowTemplateNames(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE)].flatMap((match) => (match[1] ? [match[1]] : [])))];
}

export function fillWorkflowTemplate(text: string, values: ReadonlyMap<string, string>): string {
  if (!text.includes("{{")) return text;
  return text.replace(TEMPLATE, (whole, name: string) => values.get(name) ?? whole);
}

export const WORKFLOW_TEMPLATE_FIELDS: Readonly<Partial<Record<WorkflowNodeKind, readonly string[]>>> = {
  agent: ["task"],
  llm: ["prompt", "system"],
  approval: ["question"],
};

export const WORKFLOW_CHECK_OPERATORS = ["=", "!=", ">", ">=", "<", "<=", "contains", "set", "unset"] as const;
export type WorkflowCheckOperator = (typeof WORKFLOW_CHECK_OPERATORS)[number];

export interface WorkflowCheckTest {
  name: string;
  operator: WorkflowCheckOperator;
  value: string;
}

export type WorkflowCheck = WorkflowCheckTest[][];

const COMPARISON = /^([A-Za-z_][A-Za-z0-9_]{0,39})\s*(!=|>=|<=|==|=|>|<)\s*([^\s=<>!].*)$/u;
const WORDED = /^([A-Za-z_][A-Za-z0-9_]{0,39})\s+(contains|is not|is)\s+(.+)$/iu;
const BARE = /^(not\s+)?([A-Za-z_][A-Za-z0-9_]{0,39})$/iu;

export function parseWorkflowCheck(text: string): WorkflowCheck | null {
  const groups = splitWords(text.trim(), "or").map((group) => splitWords(group, "and"));
  if (groups.length === 0 || groups.some((group) => group.length === 0)) return null;
  const check: WorkflowCheck = [];
  for (const group of groups) {
    const tests = group.map(parseTest).filter((test): test is WorkflowCheckTest => test !== null);
    if (tests.length !== group.length) return null;
    check.push(tests);
  }
  return check;
}

function parseTest(text: string): WorkflowCheckTest | null {
  const bare = BARE.exec(text);
  if (bare?.[2]) return { name: bare[2], operator: bare[1] ? "unset" : "set", value: "" };
  const compared = COMPARISON.exec(text);
  if (compared?.[1] && compared[2] && compared[3]) {
    const operator = compared[2] === "==" ? "=" : WORKFLOW_CHECK_OPERATORS.find((known) => known === compared[2]);
    if (!operator) return null;
    return { name: compared[1], operator, value: unquote(compared[3]) };
  }
  const worded = WORDED.exec(text);
  if (worded?.[1] && worded[2] && worded[3]) {
    const word = worded[2].toLowerCase();
    const operator = word === "contains" ? "contains" : word === "is" ? "=" : "!=";
    return { name: worded[1], operator, value: unquote(worded[3]) };
  }
  return null;
}

function unquote(text: string): string {
  const value = text.trim();
  return /^(["']).*\1$/u.test(value) ? value.slice(1, -1) : value;
}

function splitWords(text: string, word: "and" | "or"): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let start = 0;
  const pattern = new RegExp(`^\\s+${word}\\s+`, "iu");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if ((character === '"' || character === "'") && opensQuote(text[index - 1])) {
      quote = character;
      continue;
    }
    const match = pattern.exec(text.slice(index));
    if (match) {
      parts.push(text.slice(start, index).trim());
      index += match[0].length - 1;
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean).length === parts.length ? parts : [];
}

const opensQuote = (previous: string | undefined) => previous === undefined || /[\s=<>!]/u.test(previous);

export function workflowCheckPasses(check: WorkflowCheck, answer: WorkflowAnswer): boolean {
  return check.some((group) =>
    group.every((test) => testPasses(test, Object.hasOwn(answer, test.name) ? answer[test.name] : undefined)),
  );
}

function testPasses(test: WorkflowCheckTest, value: WorkflowAnswerValue | undefined): boolean {
  if (test.operator === "set") return isSet(value);
  if (test.operator === "unset") return !isSet(value);
  if (value === undefined) return false;
  const wanted = test.value.trim();
  if (typeof value === "object") {
    const items = value.map((item) => item.toLowerCase());
    const word = wanted.toLowerCase();
    if (test.operator === "contains") return items.some((item) => item.includes(word));
    if (test.operator === "=") return items.includes(word);
    if (test.operator === "!=") return !items.includes(word);
    return compareNumbers(test.operator, value.length, Number(wanted));
  }
  if (typeof value === "number") {
    const number = Number(wanted);
    if (test.operator === "contains") return String(value).includes(wanted);
    return compareNumbers(test.operator, value, number);
  }
  if (typeof value === "boolean") {
    const word = wanted.toLowerCase();
    const flag = word === "true" || word === "yes";
    if (test.operator === "=") return value === flag;
    if (test.operator === "!=") return value !== flag;
    return false;
  }
  const text = value.trim().toLowerCase();
  const word = wanted.toLowerCase();
  if (test.operator === "contains") return text.includes(word);
  if (test.operator === "=") return text === word;
  if (test.operator === "!=") return text !== word;
  return compareNumbers(test.operator, Number(value), Number(wanted));
}

function isSet(value: WorkflowAnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "object") return value.length > 0;
  return value.trim().length > 0;
}

function compareNumbers(operator: WorkflowCheckOperator, left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  switch (operator) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    default:
      return false;
  }
}

const PASS_THROUGH_KINDS: ReadonlySet<WorkflowNodeKind> = new Set(["condition", "approval"]);

export interface WorkflowAnswerSource {
  node: WorkflowNode;
  fields: WorkflowAnswerField[];
}

export function workflowAnswerSources(graph: WorkflowGraph, nodeId: string): WorkflowAnswerSource[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const sources: WorkflowAnswerSource[] = [];
  const seen = new Set<string>([nodeId]);
  const visit = (id: string) => {
    for (const edge of graph.edges) {
      if (edge.to !== id || edge.type !== "text" || seen.has(edge.from)) continue;
      seen.add(edge.from);
      const node = nodes.get(edge.from);
      if (!node) continue;
      const fields = workflowAnswerFieldsOf(node);
      if (fields.length > 0) sources.push({ node, fields });
      else if (PASS_THROUGH_KINDS.has(node.kind)) visit(node.id);
    }
  };
  visit(nodeId);
  return sources;
}

export function workflowInputAnswerFields(graph: WorkflowGraph, nodeId: string): Map<string, WorkflowAnswerField[]> {
  const found = new Map<string, WorkflowAnswerField[]>();
  for (const { fields } of workflowAnswerSources(graph, nodeId))
    for (const field of fields) found.set(field.name, [...(found.get(field.name) ?? []), field]);
  return found;
}

export type WorkflowAnswerProblem =
  | { nodeId: string; code: "spec"; spec: WorkflowAnswerSpecProblem }
  | { nodeId: string; code: "check" }
  | { nodeId: string; code: "field"; name: string }
  | { nodeId: string; code: "test"; name: string }
  | { nodeId: string; code: "template"; name: string; field: string }
  | { nodeId: string; code: "conflict"; name: string };

export function workflowAnswerProblems(graph: WorkflowGraph): WorkflowAnswerProblem[] {
  return graph.nodes.flatMap((node) => nodeAnswerProblems(graph, node));
}

export function nodeAnswerProblems(graph: WorkflowGraph, node: WorkflowNode): WorkflowAnswerProblem[] {
  const problems: WorkflowAnswerProblem[] = [];
  const spec = fieldString(node, WORKFLOW_ANSWER_FIELD);
  if (spec.trim() && canGiveWorkflowAnswer(node))
    for (const problem of parseWorkflowAnswerSpec(spec).problems)
      problems.push({ nodeId: node.id, code: "spec", spec: problem });
  const templated = WORKFLOW_TEMPLATE_FIELDS[node.kind] ?? [];
  const check = node.kind === "condition" ? fieldString(node, WORKFLOW_CHECK_FIELD).trim() : "";
  const names = templated.flatMap((field) =>
    workflowTemplateNames(fieldString(node, field)).map((name) => ({ field, name })),
  );
  if (!check && names.length === 0) return problems;
  const available = workflowInputAnswerFields(graph, node.id);
  const fieldOf = (name: string): WorkflowAnswerField | null | undefined => {
    const options = available.get(name);
    if (!options) return undefined;
    const kinds = new Set(options.map((option) => `${numberKind(option.type)}:${option.labels.join("|")}`));
    return kinds.size === 1 ? (options[0] ?? null) : null;
  };
  const conflicts = new Set<string>();
  const known = (name: string): WorkflowAnswerField | undefined => {
    const field = fieldOf(name);
    if (field === null && !conflicts.has(name)) {
      conflicts.add(name);
      problems.push({ nodeId: node.id, code: "conflict", name });
    }
    return field ?? undefined;
  };
  for (const { field, name } of names)
    if (!available.has(name)) problems.push({ nodeId: node.id, code: "template", name, field });
    else known(name);
  if (!check) return problems;
  const parsed = parseWorkflowCheck(check);
  if (!parsed) {
    problems.push({ nodeId: node.id, code: "check" });
    return problems;
  }
  for (const test of parsed.flat()) {
    if (!available.has(test.name)) {
      problems.push({ nodeId: node.id, code: "field", name: test.name });
      continue;
    }
    const field = known(test.name);
    if (field && !testFits(test, field)) problems.push({ nodeId: node.id, code: "test", name: test.name });
  }
  return problems;
}

const numberKind = (type: WorkflowAnswerType) => (type === "integer" ? "number" : type);

function testFits(test: WorkflowCheckTest, field: WorkflowAnswerField): boolean {
  if (test.operator === "set" || test.operator === "unset") return true;
  const ordered = test.operator === ">" || test.operator === ">=" || test.operator === "<" || test.operator === "<=";
  const value = test.value.trim().toLowerCase();
  switch (field.type) {
    case "number":
    case "integer":
      return Number.isFinite(Number(value)) || (test.operator === "contains" && value.length > 0);
    case "yes/no":
      return (test.operator === "=" || test.operator === "!=") && ["yes", "no", "true", "false"].includes(value);
    case "choice":
      return (
        (test.operator === "=" || test.operator === "!=") && field.labels.some((label) => label.toLowerCase() === value)
      );
    case "list":
      return ordered ? Number.isFinite(Number(value)) : value.length > 0;
    case "text":
      return !ordered && value.length > 0;
  }
}

export function workflowAnswerProblemName(problem: WorkflowAnswerProblem): string {
  switch (problem.code) {
    case "spec":
      return specProblemName(problem.spec);
    case "check":
      return WORKFLOW_CHECK_FIELD;
    default:
      return problem.name;
  }
}

function specProblemName(problem: WorkflowAnswerSpecProblem): string {
  switch (problem.code) {
    case "name":
      return problem.line;
    case "many":
      return WORKFLOW_ANSWER_FIELD;
    default:
      return problem.name;
  }
}

export function workflowNodeAnswerNames(node: WorkflowNode): string[] {
  const templated = (WORKFLOW_TEMPLATE_FIELDS[node.kind] ?? []).flatMap((field) =>
    workflowTemplateNames(fieldString(node, field)),
  );
  const check = node.kind === "condition" ? parseWorkflowCheck(fieldString(node, WORKFLOW_CHECK_FIELD)) : null;
  return [...new Set([...templated, ...(check?.flat().map((test) => test.name) ?? [])])];
}

export function workflowAnswerProblemText(problem: WorkflowAnswerProblem): string {
  switch (problem.code) {
    case "spec":
      return specProblemText(problem.spec);
    case "check":
      return 'check is not valid. Write tests like: priority = high, count > 2, urgent, not done, title contains "refund"; join them with and / or.';
    case "field":
      return `check uses field ${problem.name}, but no connected step before it gives that field in its answer.`;
    case "test":
      return `check cannot test field ${problem.name} like that: compare a number with = != > >= < <=, a yes/no with = yes or = no, a choice with = and one of its labels, and text or a list with = != or contains.`;
    case "template":
      return `${problem.field} uses {{${problem.name}}}, but no connected step before it gives that field in its answer, so the step fails when it runs.`;
    case "conflict":
      return `two steps before it give the field ${problem.name} with different types. Rename one of them.`;
  }
}

function specProblemText(problem: WorkflowAnswerSpecProblem): string {
  switch (problem.code) {
    case "name":
      return `answer line "${problem.line}" has no valid field name. Use letters, digits and _ (up to 40), then ": type".`;
    case "type":
      return `answer field ${problem.name} has the unknown type "${problem.type}". Use text, number, yes/no, list, or labels like high|normal|low.`;
    case "labels":
      return `answer field ${problem.name} needs two or more labels, like high|low.`;
    case "duplicate":
      return `answer field ${problem.name} is there twice.`;
    case "many":
      return `an answer has at most ${WORKFLOW_ANSWER_MAX_FIELDS} fields.`;
  }
}
