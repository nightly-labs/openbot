// Frozen optional skill-learning-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and set what that server's background memory reviews do when a chat teaches an
// agent a skill: `automatic` writes and installs the skill, `ask` asks the user in the chat first,
// `off` does neither. The snapshot gives the value and the values the host permits, so a client
// offers only those. The host refuses any other value. A member cannot use these two routes;
// `requireAdmin` on the host is the only gate.
//
// A skill question in a chat (a `skill-suggestion:*` message, see `skill-suggestion-events.ts`) gets
// one more key on the wire: `skillSuggestion` ({ name }), the skill that the question saves or
// changes. The host adds it after the frozen projection, only for a client that advertises this
// capability, in every conversation response, page and event. The frozen codecs leave it out in both
// directions, so a client copies it back from the wire value after it decodes. A value that
// `isConversationSkillSuggestion` refuses stays out, and the client shows the question as text.
//
// A member who can chat with an agent can press Save on a skill question of that agent's chat
// (`save`): the host writes the skill with its background model, with no tools, saves it in its
// library and installs it for the agent, and the skill line comes in the chat. The request names the
// question message only; the host reads the question and the chat itself. `saved: false` means the
// host saved nothing, and the client may send the user's yes to the agent instead. A protocol 9
// capability only. Widening any of it needs a second capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import { isConversationSkillSuggestion, SKILL_SUGGESTION_ITEM_TYPE_PREFIX } from "../skill-suggestion-events";
import { adminRoute, boolean, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import { decodeTeamProtocolV2Json } from "./v2";

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

/** Deeper than any conversation snapshot, page or event of the Team API. */
const MAXIMUM_DEPTH = 12;

/** The message id of a skill question, or undefined for any other value. */
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

/**
 * Sets `skillSuggestion` on each skill question in `target` from the message with the same id in
 * `source`. `target` is a value that its caller owns, such as a fresh encoder or decoder result: it
 * changes in place. A message that `target` does not send stays out.
 */
export function addSkillSuggestionNames(target: unknown, source: unknown): void {
  const names = new Map<string, string>();
  collect(source, names, 0);
  if (names.size > 0) apply(target, names, 0);
}

/**
 * `encoded`, a Team API body or event as JSON text, with the skill names of `source`, the value
 * before the protocol adapter projected it. Text without a skill question comes back unchanged.
 */
export function withSkillSuggestionNames(encoded: string, source: unknown): string {
  const names = new Map<string, string>();
  collect(source, names, 0);
  if (names.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, names, 0);
  return JSON.stringify(value);
}
