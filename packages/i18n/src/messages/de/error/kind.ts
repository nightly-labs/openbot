import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

export const messages = {
  "error.kind.network": "Verbindung fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.",
  "error.kind.timeout":
    "Die Anfrage hat zu lange gedauert. Prüfe, ob die Aktion abgeschlossen wurde, bevor du es erneut versuchst.",
  "error.kind.storage":
    "Es ist nicht genug Speicherplatz vorhanden. Gib auf dem Computer, auf dem OpenBot läuft, Speicherplatz frei und versuche es erneut.",
  "error.kind.filePermission":
    "OpenBot hat keine Berechtigung, diese Aktion abzuschließen. Prüfe die Datei- oder Ordnerberechtigungen und versuche es erneut.",
  "error.kind.notFound":
    "Eine erforderliche Datei oder ein Ordner wurde nicht gefunden. Stelle das Element wieder her oder wähle ein anderes und versuche es erneut.",
  "error.kind.readOnly":
    "Dieser Ordner ist schreibgeschützt. Wähle einen Ordner mit Schreibzugriff und versuche es erneut.",
  "error.kind.conflict":
    "Ein Element mit diesem Namen existiert bereits. Wähle einen anderen Namen und versuche es erneut.",
  "error.kind.auth":
    "Die Authentifizierung ist fehlgeschlagen. Prüfe dein Konto oder die Serververbindung und versuche es erneut.",
  "error.kind.permission": "Du hast keine Berechtigung, diese Aktion abzuschließen. Bitte den Eigentümer um Zugriff.",
  "error.kind.rateLimit": "Zu viele Anfragen. Warte einen Moment und versuche es erneut.",
  "error.kind.service": "Der Dienst ist nicht verfügbar. Warte einen Moment und versuche es erneut.",
} as const satisfies PartialTranslation<typeof source>;
