import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Download gestopt. Probeer het opnieuw.",
  "status.provider.downloadFailed": "Download mislukt. Probeer het opnieuw.",
  "status.provider.updateWaiting": "De update start als de huidige beurt klaar is.",
  "status.provider.confirmContinue": "Doorgaan",
  "status.provider.confirmCancel": "Annuleren",
  "status.provider.retryUnreachable":
    "{provider} kan geen verbinding maken met zijn server. Poging {attempt} van {maxAttempts}.",
  "status.provider.retryServerError":
    "De server van {provider} is bezet of heeft een fout. Poging {attempt} van {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} krijgt weer antwoorden van zijn server.",
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude antwoordde op de standaardsnelheid. Met een Claude-abonnement gebruikt de snelle modus gebruikstegoed. Schakel het in je Claude-account in.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude antwoordde op de standaardsnelheid. Je Claude-abonnement bevat de snelle modus niet.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude antwoordde op de standaardsnelheid. De snelle modus werkt alleen met een Anthropic-API-sleutel of een Claude-abonnement, niet met Bedrock, Vertex, Foundry of een gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude antwoordde op de standaardsnelheid. Dit model kan de snelle modus niet gebruiken in je account.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude antwoordde op de standaardsnelheid. De snelle modus is uitgeschakeld in de instellingen van Claude Code of door je organisatie.",
  "status.provider.claudeFastModeUnavailable":
    "Claude antwoordde op de standaardsnelheid. Claude Code kon de snelle modus niet gebruiken voor deze beurt.",
} as const satisfies PartialTranslation<typeof source>;
