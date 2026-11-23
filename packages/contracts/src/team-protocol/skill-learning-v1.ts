import { isDynamicRecord, isString } from "../runtime-values";
import { isConversationSkillSuggestion, SKILL_SUGGESTION_ITEM_TYPE_PREFIX } from "../skill-suggestion-events";
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const SKILL_LEARNING_CAPABILITY = "skill-learning-v1";

export const SKILL_LEARNING_ROUTES = {
  settings: "/v1/admin/host/skill-learning",
  update: "/v1/admin/host/skill-learning/update",
  save: "/v1/skill-suggestions/save",
} as const;

const mode = string(32);
const snapshot = fields({ mode, choices: list(mode, 16) });

export const SKILL_LEARNING_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SKILL_LEARNING_ROUTES.settings, adminRoute(empty, snapshot)],
  [SKILL_LEARNING_ROUTES.update, adminRoute(fields({ mode }), snapshot)],
  [
    SKILL_LEARNING_ROUTES.save,
    adminRoute(fields({ agentId: identifier, messageId: identifier }), fields({ saved: boolean })),
  ],
]);

const MAXIMUM_DEPTH = 12;

function skillQuestionId(value: unknown): string | undefined {
  if (!isDynamicRecord(value) || !isString(value.id) || !isString(value.itemType)) return undefined;
  return value.itemType.startsWith(SKILL_SUGGESTION_ITEM_TYPE_PREFIX) ? value.id : undefined;
}

function collect(value: unknown, into: Map<string, string>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const id = skillQuestionId(value);
  if (id !== undefined && isConversationSkillSuggestion(value.skillSuggestion))
    into.set(id, value.skillSuggestion.name);
  for (const child of Object.values(value)) collect(child, into, depth + 1);
}

function apply(value: unknown, names: ReadonlyMap<string, string>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, names, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const id = skillQuestionId(value);
  const name = id === undefined ? undefined : names.get(id);
  if (name !== undefined) Object.assign(value, { skillSuggestion: { name } });
  for (const child of Object.values(value)) apply(child, names, depth + 1);
}

export function addSkillSuggestionNames(target: unknown, source: unknown): void {
  const names = new Map<string, string>();
  collect(source, names, 0);
  if (names.size > 0) apply(target, names, 0);
}

export function withSkillSuggestionNames(encoded: string, source: unknown): string {
  const names = new Map<string, string>();
  collect(source, names, 0);
  if (names.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, names, 0);
  return JSON.stringify(value);
}
