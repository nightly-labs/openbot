import type { FirstAgentDraft } from "./FirstAgentSetup";

/** Give a newly created agent its standing role, or ask for a greeting when no purpose is supplied. */
export function createAgentInitialMessage(draft: Pick<FirstAgentDraft, "purpose">): string {
  const purpose = draft.purpose.trim();
  return purpose ? `Your ongoing role is: ${purpose}` : "Greet me briefly.";
}
