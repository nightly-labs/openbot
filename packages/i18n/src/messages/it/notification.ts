import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Ha bisogno di te.",
  "notification.needsApproval": "Ha bisogno della tua approvazione.",
  "notification.finished": "Ha finito di lavorare.",
  "notification.failed": "Si è fermato per un errore.",
  "notification.usageLimit.title": "L'account {provider} ha raggiunto il limite",
  "notification.usageLimit.body": {
    one: "{count} agente è in attesa. OpenBot riproverà più tardi.",
    other: "{count} agenti sono in attesa. OpenBot riproverà più tardi.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agente è in attesa. Si azzera {reset}.",
    other: "{count} agenti sono in attesa. Si azzera {reset}.",
  },
  "notification.test": "Le notifiche funzionano.",
  "notification.welcome": "OpenBot ti avviserà qui quando un agente ha bisogno di te.",
  "notification.toast.region": "Notifiche",
  "notification.toast.close": "Chiudi notifica",
} as const satisfies PartialTranslation<typeof source>;
