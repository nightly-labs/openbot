import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Melde dich an, um zu teilen",
  "mobile.share.signInDescription":
    "Scanne den QR-Code in OpenBot auf deinem Computer. Danach kannst du den Agenten wählen, der den geteilten Inhalt bekommt.",
  "mobile.share.reading": "Geteilter Inhalt wird gelesen…",
  "mobile.share.readFailed": "OpenBot konnte den geteilten Inhalt nicht lesen. Teile ihn noch einmal.",
  "mobile.share.content": "Zum Teilen",
  "mobile.share.footer":
    "Der Chat öffnet sich mit diesem Inhalt im Nachrichtenfeld. Nichts wird gesendet, bevor du es sendest.",
  "mobile.share.lastUsed": "Zuletzt verwendet",
  "mobile.share.noAgents": "Keine Agenten",
  "mobile.share.chooseAgent": "Agenten wählen",
  "mobile.share.action": "Mit {name} teilen",
  "mobile.share.extension.send": "Senden",
  "mobile.share.extension.footer": "OpenBot sendet dies jetzt an den Agenten. Die App öffnet sich nicht.",
  "mobile.share.extension.sending": "Wird an {name} gesendet…",
  "mobile.share.extension.sent": "An {name} gesendet",
  "mobile.share.extension.failed": "OpenBot konnte dies nicht senden. Öffne die App, um es von dort zu senden.",
  "mobile.share.extension.unconfirmed":
    "Der Server hat die Nachricht nicht bestätigt. Sieh im Chat nach, bevor du sie noch einmal sendest.",
  "mobile.share.extension.openApp": "OpenBot öffnen",
} as const satisfies PartialTranslation<typeof source>;
