import type { MobileAgent } from "./workspace-types";

/**
 * The fields that change with each delivered message. The quick actions, the share extension, the
 * shortcuts, the notification pictures and the Live Activity do not show them.
 */
const MESSAGE_FIELDS: ReadonlySet<string> = new Set<keyof MobileAgent>(["preview", "updatedAt", "updatedLabel"]);

/** Whether the two records differ only in the fields of the latest message. */
export function sameAgentApartFromMessage(previous: MobileAgent, next: MobileAgent): boolean {
  if (previous === next) return true;
  const before = new Map<string, unknown>(Object.entries(previous));
  const after = Object.entries(next);
  if (after.length !== before.size) return false;
  return after.every(
    ([key, value]) => MESSAGE_FIELDS.has(key) || (before.has(key) && Object.is(before.get(key), value)),
  );
}

/** Whether the two lists differ only in the fields of the latest message. */
export function sameAgentsApartFromMessage(previous: readonly MobileAgent[], next: readonly MobileAgent[]): boolean {
  return keepDirectoryAgents(previous, next) === previous;
}

/**
 * The agents for the parts of the app that do not show the latest message. It keeps `previous` while
 * only the message fields change, so these parts do not compute their data again for each message.
 * The workspace keeps unchanged nested values (`replaceEqualDeep`), so a reference check is enough.
 */
export function keepDirectoryAgents(
  previous: readonly MobileAgent[],
  next: readonly MobileAgent[],
): readonly MobileAgent[] {
  if (previous === next) return previous;
  if (previous.length !== next.length) return next;
  return next.every((agent, index) => {
    const before = previous[index];
    return before !== undefined && sameAgentApartFromMessage(before, agent);
  })
    ? previous
    : next;
}
