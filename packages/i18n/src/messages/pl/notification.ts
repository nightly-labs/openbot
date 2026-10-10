import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Potrzebuje twojej odpowiedzi.",
  "notification.needsApproval": "Potrzebuje twojego zatwierdzenia.",
  "notification.finished": "Zakończono pracę.",
  "notification.failed": "Zatrzymano z powodu błędu.",
  "notification.usageLimit.title": "Konto {provider} osiągnęło limit",
  "notification.usageLimit.body": {
    one: "{count} agent czeka. OpenBot spróbuje ponownie później.",
    few: "{count} agentów czeka. OpenBot spróbuje ponownie później.",
    many: "{count} agentów czeka. OpenBot spróbuje ponownie później.",
    other: "{count} agenta czeka. OpenBot spróbuje ponownie później.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent czeka. Reset: {reset}.",
    few: "{count} agentów czeka. Reset: {reset}.",
    many: "{count} agentów czeka. Reset: {reset}.",
    other: "{count} agenta czeka. Reset: {reset}.",
  },
  "notification.test": "Powiadomienia działają.",
  "notification.welcome": "OpenBot powiadomi cię tutaj, gdy agent będzie cię potrzebować.",
  "notification.toast.region": "Powiadomienia",
  "notification.toast.close": "Zamknij powiadomienie",
} as const satisfies PartialTranslation<typeof source>;
