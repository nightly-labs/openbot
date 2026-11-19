import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { appLanguageOption } from "@openbot/i18n/languages";
import type { TranslatedLocale } from "@openbot/i18n/mobile";

export type NewAgentInput = Omit<CreateAgentInput, "initialMessage"> & { firstTask?: string };

export function agentInitialMessage(
  roleDescription: string,
  task: string,
  welcome: { locale: TranslatedLocale } | null,
): string {
  if (welcome)
    return agentWelcomeMessage({
      language: appLanguageOption(welcome.locale).label,
      firstRequestFollows: task.trim().length > 0,
    });
  const parts = [roleDescription.trim() ? `Your ongoing role is: ${roleDescription.trim()}` : "", task.trim()].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join("\n\n") : "Greet me briefly.";
}
