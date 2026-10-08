import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Wird bearbeitet…",
  "status.messaging.queued": "Wartet: OpenBot bearbeitet eine andere Anfrage. Die Antwort erscheint hier.",
  "status.messaging.busy": "Zu viele Anfragen warten. Versuche es später erneut.",
  "status.messaging.failed": "OpenBot konnte diese Anfrage nicht abschließen. Der OpenBot-Host hat die Details.",
  "status.messaging.noAnswer": "OpenBot wurde ohne schriftliche Antwort fertig.",
  "status.messaging.noAgent": "Hier kann noch kein Agent antworten. Füge den Slack-Koordinator in OpenBot hinzu.",
  "status.messaging.delegated": "Ein Teamkollege arbeitet daran. Die Antwort erscheint hier.",
  "status.messaging.stopped": "Gestoppt.",
  "status.messaging.stop": "Stoppen",
  "status.messaging.approvalTitle": "OpenBot bittet um Freigabe zum Fortfahren.",
  "status.messaging.approvalCommand": "Einen Befehl ausführen",
  "status.messaging.approvalFileChange": "Dateien ändern",
  "status.messaging.approvalPermissions": "Weitere Berechtigungen erhalten",
  "status.messaging.approve": "Freigeben",
  "status.messaging.deny": "Ablehnen",
  "status.messaging.approvedBy": "Von {user} freigegeben.",
  "status.messaging.deniedBy": "Von {user} abgelehnt.",
  "status.messaging.answeredOnHost": "Auf dem OpenBot-Host beantwortet.",
  "status.messaging.requestInactive": "Diese Anfrage ist nicht mehr aktiv.",
  "status.messaging.onlyRequester": "Nur {user} kann dies tun. Der OpenBot-Host kann ebenfalls antworten.",
  "status.messaging.hostOnly": "Nur der OpenBot-Host kann diese Anfrage beantworten.",
  "status.messaging.filesSkipped": "Einige Dateien wurden nicht gesendet: {names}.",
  "status.messaging.orchestratorName": "Slack-Koordinator",
  "status.messaging.orchestratorTitle": "Antwortet in Slack und fragt das Team",
  "status.messaging.discordNoAgent":
    "Hier kann noch kein Agent antworten. Füge den Discord-Koordinator in OpenBot hinzu.",
  "status.messaging.discordOrchestratorName": "Discord-Koordinator",
  "status.messaging.discordOrchestratorTitle": "Antwortet in Discord und fragt das Team",
  "status.messaging.integrationsSection": "Integrationen",
  "status.messaging.signInReceived": "OpenBot hat die Slack-Installation empfangen. Du kannst diesen Tab schließen.",
  "status.messaging.signInUnknown":
    "OpenBot hat diese Slack-Installation nicht gestartet. Starte sie erneut in OpenBot.",
} as const satisfies PartialTranslation<typeof source>;
