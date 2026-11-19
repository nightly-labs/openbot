import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import { appLanguageOption } from "@openbot/i18n/languages";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { currentText } from "@openbot/ui/text";

export function createAgentInitialMessage(draft: Pick<FirstAgentDraft, "purpose">, welcomeSupported: boolean): string {
  if (welcomeSupported) return agentWelcomeMessage({ language: appLanguageOption(currentText().locale()).label });
  const purpose = draft.purpose.trim();
  return purpose ? `Your ongoing role is: ${purpose}` : "Greet me briefly.";
}
