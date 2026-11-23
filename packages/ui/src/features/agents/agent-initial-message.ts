import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import { appLanguageOption } from "@openbot/i18n/languages";
import { currentText } from "../../text";
import type { FirstAgentDraft } from "./FirstAgentSetup";

export function createAgentInitialMessage(draft: Pick<FirstAgentDraft, "purpose">, welcomeSupported: boolean): string {
  if (welcomeSupported) return agentWelcomeMessage({ language: appLanguageOption(currentText().locale()).label });
  const purpose = draft.purpose.trim();
  return purpose ? `Your ongoing role is: ${purpose}` : "Greet me briefly.";
}
