import type { WorkflowGraph, WorkflowNode, WorkflowNodeKind } from "./ipc-workflows";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

export const WORKFLOW_ANSWER_FIELD = "answer";
export const WORKFLOW_CHECK_FIELD = "check";
export const WORKFLOW_ANSWER_MAX_FIELDS = 20;
export const WORKFLOW_ANSWER_TYPES = ["text", "number", "yes/no", "list", "choice"] as const;
export type WorkflowAnswerType = (typeof WORKFLOW_ANSWER_TYPES)[number];

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

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/u;
const TEMPLATE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/gu;
const TYPE_WORDS: Readonly<Record<string, WorkflowAnswerType>> = {
  text: "text",
  string: "text",
  number: "number",
  integer: "number",
  int: "number",
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
  const known = TYPE_WORDS[word || "text"];
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

export function formatWorkflowAnswerSpec(fields: readonly WorkflowAnswerField[]): string {
  return fields
    .map(
      (field) =>
        `${field.name}${field.optional ? "?" : ""}: ${field.type === "choice" ? field.labels.join("|") : field.type}`,
    )
    .join("\n");
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

export type WorkflowAnswerValueProblem = { name: string; problem: "missing" | "type" | "label" };

export function checkWorkflowAnswer(
  fields: readonly WorkflowAnswerField[],
  value: unknown,
): { answer: WorkflowAnswer; problems: WorkflowAnswerValueProblem[] } {
  const record: DynamicRecord = isDynamicRecord(value) ? value : {};
  const answer: Record<string, WorkflowAnswerValue> = {};
  const problems: WorkflowAnswerValueProblem[] = [];
  for (const field of fields) {
    const raw = record[field.name];
    if (raw === undefined || raw === null || raw === "") {
      if (!field.optional) problems.push({ name: field.name, problem: "missing" });
      continue;
    }
    const checked = answerValue(field, raw);
    if (typeof checked === "object" && checked !== null && "problem" in checked)
      problems.push({ name: field.name, problem: checked.problem });
    else answer[field.name] = checked;
  }
  return { answer, problems };
}

function answerValue(field: WorkflowAnswerField, raw: unknown): WorkflowAnswerValue | { problem: "type" | "label" } {
  switch (field.type) {
    case "text":
      if (typeof raw === "string") return raw.trim();
      return typeof raw === "number" || typeof raw === "boolean" ? String(raw) : { problem: "type" };
    case "number": {
      const number = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
      return Number.isFinite(number) && !(typeof raw === "string" && raw.trim() === "") ? number : { problem: "type" };
    }
    case "yes/no": {
      if (typeof raw === "boolean") return raw;
      const word = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (word === "true" || word === "yes") return true;
      if (word === "false" || word === "no") return false;
      return { problem: "type" };
    }
    case "list": {
      const items = Array.isArray(raw) ? raw : [raw];
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
  return problems
    .map(({ name, problem }) =>
      problem === "missing"
        ? `${name} is missing`
        : problem === "label"
          ? `${name} is not one of the labels`
          : `${name} has the wrong type`,
    )
    .join("; ");
}

export function lastJsonObject(text: string): DynamicRecord | null {
  let found: DynamicRecord | null = null;
  for (let start = text.indexOf("{"); start >= 0; ) {
    const end = balancedEnd(text, start);
    if (end < 0) break;
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

export function workflowAnswerOfText(text: string): WorkflowAnswer | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const record = parseRecord(trimmed);
  return record ? plainAnswer(record) : null;
}

export function plainAnswer(record: DynamicRecord): WorkflowAnswer {
  const answer: Record<string, WorkflowAnswerValue> = {};
  for (const [name, value] of Object.entries(record)) {
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      answer[name] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) answer[name] = value;
  }
  return answer;
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

export function fillWorkflowTemplate(text: string, answer: WorkflowAnswer | null): string {
  if (!text.includes("{{")) return text;
  return text.replace(TEMPLATE, (_whole, name: string) => workflowAnswerValueText(answer?.[name]));
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
    if (character === '"' || character === "'") {
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

export function workflowCheckPasses(check: WorkflowCheck, answer: WorkflowAnswer): boolean {
  return check.some((group) => group.every((test) => testPasses(test, answer[test.name])));
}

function testPasses(test: WorkflowCheckTest, value: WorkflowAnswerValue | undefined): boolean {
  if (test.operator === "set") return isSet(value);
  if (test.operator === "unset") return !isSet(value);
  if (value === undefined) return test.operator === "!=";
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

export function workflowInputAnswerFields(graph: WorkflowGraph, nodeId: string): Map<string, WorkflowAnswerField[]> {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const found = new Map<string, WorkflowAnswerField[]>();
  const seen = new Set<string>([nodeId]);
  const visit = (id: string) => {
    for (const edge of graph.edges) {
      if (edge.to !== id || edge.type !== "text" || seen.has(edge.from)) continue;
      seen.add(edge.from);
      const source = nodes.get(edge.from);
      if (!source) continue;
      const fields = workflowAnswerFieldsOf(source);
      for (const field of fields) found.set(field.name, [...(found.get(field.name) ?? []), field]);
      if (fields.length === 0 && PASS_THROUGH_KINDS.has(source.kind)) visit(source.id);
    }
  };
  visit(nodeId);
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
    const kinds = new Set(options.map((option) => `${option.type}:${option.labels.join("|")}`));
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

function testFits(test: WorkflowCheckTest, field: WorkflowAnswerField): boolean {
  if (test.operator === "set" || test.operator === "unset") return true;
  const ordered = test.operator === ">" || test.operator === ">=" || test.operator === "<" || test.operator === "<=";
  const value = test.value.trim().toLowerCase();
  switch (field.type) {
    case "number":
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
      return `${problem.field} uses {{${problem.name}}}, but no connected step before it gives that field in its answer.`;
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
