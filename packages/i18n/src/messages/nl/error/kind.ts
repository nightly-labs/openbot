import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Kan geen verbinding maken. Controleer je verbinding en probeer het opnieuw.",
  "error.kind.timeout":
    "Het verzoek duurde te lang. Controleer of de actie is voltooid voordat je het opnieuw probeert.",
  "error.kind.storage":
    "Er is niet genoeg opslagruimte. Maak ruimte vrij op de computer waarop OpenBot draait en probeer het opnieuw.",
  "error.kind.filePermission":
    "OpenBot heeft geen toestemming om deze actie uit te voeren. Controleer de rechten van het bestand of de map en probeer het opnieuw.",
  "error.kind.notFound":
    "Een benodigd bestand of een benodigde map is niet gevonden. Zet het terug of kies een ander, en probeer het opnieuw.",
  "error.kind.readOnly": "Deze map is alleen-lezen. Kies een map waarin je kunt schrijven en probeer het opnieuw.",
  "error.kind.conflict": "Er bestaat al een item met deze naam. Kies een andere naam en probeer het opnieuw.",
  "error.kind.auth":
    "Verificatie is mislukt. Controleer je account of de verbinding met de server en probeer het opnieuw.",
  "error.kind.permission": "Je hebt geen toestemming om deze actie uit te voeren. Vraag de eigenaar om toegang.",
  "error.kind.rateLimit": "Te veel verzoeken. Wacht even en probeer het opnieuw.",
  "error.kind.service": "De service is niet beschikbaar. Wacht even en probeer het opnieuw.",
} as const satisfies PartialTranslation<typeof source>;
