import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Potrzebuje twojej odpowiedzi.",
  "notification.needsApproval": "Potrzebuje twojego zatwierdzenia.",
  "notification.needsBrowserStep": "Potrzebuje dokończenia kroku w przeglądarce.",
  "notification.needsApprovalFor": "Potrzebuje twojego zatwierdzenia: {action}",
  "notification.finished": "Zakończono pracę.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Krok czeka na Twoje zatwierdzenie.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Przepływ pracy ma nowy wynik.",
  "notification.failed": "Zatrzymano z powodu błędu.",
  "notification.channelTitle": "{agent} w kanale {channel}",
  "notification.channelMessage": "Nowa wiadomość.",
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
  "notification.machineAlert.disk": "{server}: dysk zapełniony w {percent}",
  "notification.machineAlert.memory": "{server}: pamięć zajęta w {percent}",
  "notification.machineAlert.cpu": "{server}: CPU obciążony w {percent}",
  "notification.machineAlert.body": "Przekroczono poziom alertu {level}. Zobacz Ustawienia serwera > Pamięć dyskowa.",
  "notification.test": "Powiadomienia działają.",
  "notification.welcome": "OpenBot powiadomi cię tutaj, gdy agent będzie cię potrzebować.",
  "notification.toast.region": "Powiadomienia",
  "notification.toast.close": "Zamknij powiadomienie",
} as const satisfies PartialTranslation<typeof source>;
