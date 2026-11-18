import { agentWelcomeMessage } from "@openbot/contracts/agent-welcome";
import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { appLanguageOption } from "@openbot/i18n/languages";
import type { TranslatedLocale } from "@openbot/i18n/mobile";

/** A new agent as a screen asks for it. `firstTask` is what the user wrote for the agent to do first. */
export type NewAgentInput = Omit<CreateAgentInput, "initialMessage"> & { firstTask?: string };

/**
 * The first message of a new agent. A host with `agent-welcome-v1` hides it, so it is a setup message
 * and the user sees only the agent's welcome. The first task then goes as the user's own next message.
 *
 * An older host shows the first message as the user's, so it keeps the released text: the role, and
 * the first task when the user wrote one. With neither, the agent greets the user. Agent prompts stay
 * in English; the user's words do not change.
 */
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
