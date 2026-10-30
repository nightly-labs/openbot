import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/messaging";

export const messages = {
  "messaging.help.invalid_token":
    "Slack accepteert OpenBot niet meer in deze werkruimte. De app is misschien verwijderd. Verbind de werkruimte opnieuw.",
  "messaging.help.secret_storage_unavailable":
    "OpenBot kan de opgeslagen tokens op deze computer niet lezen. Verbreek de verbinding met de werkruimte en verbind hem daarna opnieuw.",
  "messaging.help.relay_unavailable":
    "OpenBot kan geen Slack-events ontvangen op deze computer. Log in, geef deze computer een naam in de serverinstellingen en houd OpenBot open.",
  "messaging.discordHelp.invalid_token":
    "Discord accepteert OpenBot niet meer in deze Discord-server. De app is misschien verwijderd. Verbind de Discord-server opnieuw.",
  "messaging.discordHelp.secret_storage_unavailable":
    "OpenBot kan de opgeslagen tokens op deze computer niet lezen. Verbreek de verbinding met de Discord-server en verbind hem daarna opnieuw.",
  "messaging.discordHelp.relay_unavailable":
    "OpenBot kan geen Discord-events ontvangen op deze computer. Log in, geef deze computer een naam in de serverinstellingen en houd OpenBot open.",
} as const satisfies PartialTranslation<typeof source>;
