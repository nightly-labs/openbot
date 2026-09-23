import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentApprovalPermissions,
  AgentPromptQuestion,
  AgentPromptResolution,
  RespondToBrowserTakeoverInput,
} from "@openbot/contracts/ipc";
import { COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type DynamicToolResult, getArray, getRecord, getString, isRecord } from "../protocol";

export const MCP_ELICITATION_DECISION_ID = "mcp-elicitation-decision";
export const MCP_ELICITATION_ALLOW_ONCE = "Allow once";
export const MCP_ELICITATION_ALLOW_ALWAYS = "Always allow";
export const MCP_ELICITATION_DECLINE = "Don't allow";
/** Field names a plugin uses for a credential. A match keeps the answer out of stored history. */
const SECRET_FIELD_PATTERN = /api[_-]?key|secret|token|password|passphrase|credential/i;

export type ElicitationFieldValue = string | number | boolean | string[];

export function secretElicitationField(id: string, property: DynamicRecord | undefined): boolean {
  if (property?.writeOnly === true || getString(property, "format") === "password") return true;
  return SECRET_FIELD_PATTERN.test(`${id} ${getString(property, "title") ?? ""}`);
}

export function elicitationOptions(property: DynamicRecord): Array<{ label: string; description: string }> | null {
  if (Array.isArray(property.oneOf)) {
    return property.oneOf.filter(isRecord).flatMap((option) => {
      const value = getString(option, "const");
      if (!value) return [];
      return [{ label: getString(option, "title") ?? value, description: getString(option, "description") ?? "" }];
    });
  }
  if (Array.isArray(property.enum)) {
    return property.enum.filter(isString).map((value) => ({ label: value, description: "" }));
  }
  if (property.type === "boolean") {
    return [
      { label: "Yes", description: "" },
      { label: "No", description: "" },
    ];
  }
  return null;
}

export function elicitationValue(property: DynamicRecord | undefined, answers: string[]): ElicitationFieldValue {
  if (!property) return answers[0] ?? "";
  if (property.type === "array") return answers;
  if (property.type === "boolean") return /^(yes|true|1)$/i.test(answers[0] ?? "");
  if (Array.isArray(property.oneOf)) {
    // The card submits the displayed label, which is the title when the schema names one: the
    // response must carry the const the schema asked for instead.
    const selected = property.oneOf
      .filter(isRecord)
      .find((option) => (getString(option, "title") ?? getString(option, "const")) === answers[0]);
    if (selected) return getString(selected, "const") ?? answers[0] ?? "";
  }
  if (property.type === "number" || property.type === "integer") {
    const parsed = Number(answers[0]);
    return Number.isFinite(parsed) ? parsed : (answers[0] ?? "");
  }
  return answers[0] ?? "";
}

export function commandText(params: unknown): string | null {
  if (!isRecord(params)) return null;
  const command = params.command;
  if (isString(command)) return command;
  if (Array.isArray(command) && command.every(isString)) return command.join(" ");
  return null;
}

export function promptQuestions(params: unknown): AgentPromptQuestion[] {
  return getArray(params, "questions")
    .filter(isRecord)
    .map((question) => ({
      id: getString(question, "id") ?? randomUUID(),
      header: getString(question, "header") ?? "Question",
      question: getString(question, "question") ?? "The agent needs more information.",
      isSecret: question.isSecret === true,
      options: Array.isArray(question.options)
        ? question.options.filter(isRecord).map((option) => ({
            label: getString(option, "label") ?? "Option",
            description: getString(option, "description") ?? "",
          }))
        : null,
    }));
}

/** A schema that asks for nothing is a consent hand-off: the plugin wants a yes or no. */
function elicitationConsentQuestion(params: unknown, serverName: string | null): AgentPromptQuestion | null {
  const message = getString(params, "message")?.trim();
  if (!message) return null;
  const subject = serverName === COMPUTER_USE_MCP_SERVER_NAME ? "Computer Use" : (serverName ?? "this plugin");
  const persistence = getArray(getRecord(params, "_meta"), "persist").filter(isString);
  return {
    id: MCP_ELICITATION_DECISION_ID,
    header: subject.slice(0, INPUT_LIMITS.promptHeader),
    question: message.slice(0, INPUT_LIMITS.promptQuestion),
    isSecret: false,
    options: [
      { label: MCP_ELICITATION_ALLOW_ONCE, description: `Allow this ${subject} request.` },
      ...(persistence.includes("always")
        ? [{ label: MCP_ELICITATION_ALLOW_ALWAYS, description: `Remember this access for future ${subject} requests.` }]
        : []),
      { label: MCP_ELICITATION_DECLINE, description: "Keep access blocked." },
    ],
  };
}

/** One question per requested field, so a plugin can collect an API key or any other value. */
export function elicitationFieldQuestions(params: unknown, subject: string): AgentPromptQuestion[] {
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties") ?? {};
  const message = getString(params, "message")?.trim();
  return Object.entries(properties).flatMap(([id, property]) => {
    if (!isRecord(property)) return [];
    const question = getString(property, "description") ?? message ?? `${subject} needs more information.`;
    return [
      {
        id,
        header: (getString(property, "title") ?? id).slice(0, INPUT_LIMITS.promptHeader),
        question: question.slice(0, INPUT_LIMITS.promptQuestion),
        isSecret: secretElicitationField(id, property),
        options: elicitationOptions(property),
      },
    ];
  });
}

export function mcpElicitationQuestions(params: unknown): AgentPromptQuestion[] | null {
  const serverName = getString(params, "serverName");
  const mode = getString(params, "mode") ?? "form";
  const requestedSchema = getRecord(params, "requestedSchema");
  const properties = getRecord(requestedSchema, "properties");
  if ((mode !== "form" && mode !== "openai/form") || !requestedSchema || !properties) return null;

  const questions =
    Object.keys(properties).length === 0
      ? [elicitationConsentQuestion(params, serverName)].filter((question) => question !== null)
      : elicitationFieldQuestions(params, serverName ?? "This plugin");
  return validPromptQuestions(questions) ? questions : null;
}

export function mcpElicitationResult(
  params: unknown,
  answers: Record<string, string[]>,
): { action: "accept" | "cancel" | "decline"; content: DynamicRecord | null; _meta: DynamicRecord | null } {
  const properties = getRecord(getRecord(params, "requestedSchema"), "properties");
  if (properties && Object.keys(properties).length > 0) {
    return elicitationFieldResult(params, properties, answers);
  }
  const selected = answers[MCP_ELICITATION_DECISION_ID]?.[0];
  if (selected === MCP_ELICITATION_ALLOW_ONCE) {
    return { action: "accept", content: {}, _meta: null };
  }
  if (selected === MCP_ELICITATION_ALLOW_ALWAYS && getArray(getRecord(params, "_meta"), "persist").includes("always")) {
    return { action: "accept", content: {}, _meta: { persist: "always" } };
  }
  if (selected === MCP_ELICITATION_DECLINE) {
    return { action: "decline", content: null, _meta: null };
  }
  return { action: "cancel", content: null, _meta: null };
}

/** A skipped required field declines the request: a partial form is not an answer. */
function elicitationFieldResult(
  params: unknown,
  properties: DynamicRecord,
  answers: Record<string, string[]>,
): { action: "accept" | "decline"; content: DynamicRecord | null; _meta: DynamicRecord | null } {
  const content: Record<string, ElicitationFieldValue> = {};
  for (const [id, values] of Object.entries(answers)) {
    if (values.length === 0) continue;
    content[id] = elicitationValue(getRecord(properties, id) ?? undefined, values);
  }
  const required = getArray(getRecord(params, "requestedSchema"), "required").filter(isString);
  if (required.some((id) => !(id in content)) || Object.keys(content).length === 0) {
    return { action: "decline", content: null, _meta: null };
  }
  return { action: "accept", content, _meta: null };
}

export function validPromptQuestions(questions: AgentPromptQuestion[]): boolean {
  return (
    questions.length > 0 &&
    questions.length <= INPUT_LIMITS.promptQuestions &&
    new Set(questions.map((question) => question.id)).size === questions.length &&
    questions.every(
      (question) =>
        question.id.length > 0 &&
        question.id.length <= INPUT_LIMITS.identifier &&
        question.header.length <= INPUT_LIMITS.promptHeader &&
        question.question.length > 0 &&
        question.question.length <= INPUT_LIMITS.promptQuestion &&
        (question.options === null ||
          (question.options.length <= INPUT_LIMITS.promptOptions &&
            question.options.every(
              (option) =>
                option.label.length > 0 &&
                option.label.length <= INPUT_LIMITS.promptOptionLabel &&
                option.description.length <= INPUT_LIMITS.promptOptionDescription,
            ))),
    )
  );
}

export function questionPromptText(questions: AgentPromptQuestion[], resolution: AgentPromptResolution | null): string {
  const responses = resolution?.status === "answered" ? resolution.responses : null;
  return questions
    .map((question) => {
      const lines = [`Question: ${question.question}`];
      if (!responses) return lines.join("\n");
      const response = responses[question.id];
      if (!response || response.status === "skipped") lines.push("Answer: Skipped");
      else if (question.isSecret || !response.answers) lines.push("Answer: Private answer");
      else lines.push(`Answer: ${response.answers.join(", ")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function promptResolution(
  questions: AgentPromptQuestion[],
  answers: Record<string, string[]>,
): AgentPromptResolution {
  if (Object.keys(answers).length === 0) return { status: "cancelled" };
  return {
    status: "answered",
    responses: Object.fromEntries(
      questions.map((question) => {
        const values = answers[question.id] ?? [];
        if (values.length === 0) return [question.id, { status: "skipped" }];
        return [question.id, question.isSecret ? { status: "answered" } : { status: "answered", answers: [...values] }];
      }),
    ),
  };
}

export function dynamicPromptResult(answers: Record<string, string[]>): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(answers) }],
  };
}

export function browserTakeoverResult(decision: RespondToBrowserTakeoverInput["decision"]): DynamicToolResult {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: decision === "complete" ? "completed" : "cancelled",
          ...(decision === "complete" ? { next: "Take a fresh snapshot and continue the task." } : {}),
        }),
      },
    ],
  };
}

export function browserTakeoverError(
  message = "OpenBot could not create a browser takeover request.",
): DynamicToolResult {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: message }],
  };
}

export function approvalPermissions(params: unknown): AgentApprovalPermissions {
  const permissions = getRecord(params, "permissions");
  const fileSystem = getRecord(permissions, "fileSystem");
  const network = getRecord(permissions, "network");
  const read = getArray(fileSystem, "read").filter(isString);
  const write = getArray(fileSystem, "write").filter(isString);
  return {
    fileSystem: { read, write },
    network: network?.enabled === true,
  };
}
