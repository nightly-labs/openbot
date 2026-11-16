/**
 * Internal marker for workflow package-context handoffs (B-isolation-1 Criterion 6 / Oracle B).
 * Ephemeral routine sessions that carry this marker omit ambient chat / earlier-run history and
 * rely on the delivery text (pins + brief + predecessor outputs) alone.
 */

/** Mirrors `CURRENT_MESSAGE_SEPARATOR` in delivery-content (kept local to avoid an import cycle). */
const CURRENT_MESSAGE_SEPARATOR = "\n\n--- current message ---\n";

export const WORKFLOW_PACKAGE_CONTEXT_MARKER = "OpenBot-Package-Context: workflow";

/** True when a delivery text is a workflow package handoff. */
export function isWorkflowPackageContext(text: string): boolean {
  return text.startsWith(`${WORKFLOW_PACKAGE_CONTEXT_MARKER}\n`) || text === WORKFLOW_PACKAGE_CONTEXT_MARKER;
}

/** Prefixes the marker for sendAgentStep → enqueueHandoff → session startup. */
export function withWorkflowPackageContext(text: string): string {
  if (isWorkflowPackageContext(text)) return text;
  return `${WORKFLOW_PACKAGE_CONTEXT_MARKER}\n\n${text}`;
}

/** Strips the marker so the agent prompt and UI do not show the internal flag. */
export function withoutWorkflowPackageContext(text: string): string {
  if (!isWorkflowPackageContext(text)) return text;
  const rest = text.slice(WORKFLOW_PACKAGE_CONTEXT_MARKER.length);
  return rest.replace(/^\n+/, "");
}

/**
 * Drain's batch decision for ephemeral routine sessions (same predicate as `DrainScheduler`):
 * any routine delivery carrying the package-context marker omits ambient chat / earlier-run history.
 */
export function batchOmitsAmbientHistory(
  batch: ReadonlyArray<{ delivery: { sender: { kind: string }; text: string } }>,
): boolean {
  return batch.some((item) => item.delivery.sender.kind === "routine" && isWorkflowPackageContext(item.delivery.text));
}

type FirstTurnItem = { type: string; text?: string };

/**
 * Ambient chat / earlier-run history for an ephemeral routine session. Package-context handoffs
 * return null so the first turn sees only the delivery text (pins + brief + predecessors).
 * `omitAmbientHistory` must come from `batchOmitsAmbientHistory` (or `startRoutineThread` options
 * set from that predicate) — never a hardcoded true.
 */
export function routineSessionAmbientHandoff(omitAmbientHistory: boolean, build: () => string | null): string | null {
  return omitAmbientHistory ? null : build();
}

/**
 * Drain's first-turn composition for an ephemeral routine session: prepend ambient handoff when
 * present. Package-context sessions pass `ambientHandoff: null` so main-chat / earlier-run history
 * cannot enter the payload.
 */
export function composeEphemeralRoutineFirstTurn<T extends FirstTurnItem>(
  deliveryItems: readonly T[],
  ambientHandoff: string | null,
): T[] {
  if (!ambientHandoff || deliveryItems.length === 0) return [...deliveryItems];
  return deliveryItems.map((item, index) =>
    index === 0 && item.type === "text" && typeof item.text === "string"
      ? { ...item, text: `${ambientHandoff}${CURRENT_MESSAGE_SEPARATOR}${item.text}` }
      : item,
  );
}

/** Flatten text items from a first-turn payload for offline inspection. */
export function firstTurnPayloadText(items: readonly FirstTurnItem[]): string {
  return items.flatMap((item) => (item.type === "text" && item.text ? [item.text] : [])).join("\n");
}
