import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Log in om te delen",
  "mobile.share.signInDescription":
    "Scan de QR-code in OpenBot op je computer. Daarna kun je de agent kiezen die krijgt wat je hebt gedeeld.",
  "mobile.share.reading": "Gedeelde inhoud lezen…",
  "mobile.share.readFailed": "OpenBot kan niet lezen wat je hebt gedeeld. Deel het opnieuw.",
  "mobile.share.content": "Te delen",
  "mobile.share.footer": "De chat opent met dit in het berichtveld. Er wordt niets verstuurd totdat jij het verstuurt.",
  "mobile.share.lastUsed": "Laatst gebruikt",
  "mobile.share.noAgents": "Geen agents",
  "mobile.share.chooseAgent": "Kies een agent",
  "mobile.share.action": "Deel met {name}",
} as const satisfies PartialTranslation<typeof source>;
