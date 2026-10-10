import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot nie mógł się połączyć. Spróbuj ponownie.",
  "mobile.link.invite.signInTitle": "Zaloguj się, aby dołączyć do tego serwera",
  "mobile.link.invite.signInDescription":
    "Zeskanuj kod QR w OpenBot na komputerze. Potem możesz przejrzeć zaproszenie.",
  "mobile.link.invite.cancel": "Anuluj zaproszenie",
  "mobile.link.pairing.title": "Połącz ten telefon",
  "mobile.link.pairing.alreadySignedIn":
    "Logowanie jest już aktywne. Wyloguj się w Ustawieniach, zanim połączysz inne konto.",
  "mobile.link.pairing.description": "Kontynuuj tylko wtedy, gdy ten link Mobile Connect pochodzi z twojego komputera.",
  "mobile.link.pairing.connect": "Połącz",
  "mobile.link.plugin.title": "Otwórz stronę wtyczki",
  "mobile.link.plugin.description": "Zobacz tę wtyczkę na stronie OpenBot.",
  "mobile.link.plugin.openFailed": "Nie udało się otworzyć strony wtyczki.",
  "mobile.link.plugin.view": "Zobacz wtyczkę",
  "mobile.link.unavailable.title": "Link niedostępny",
  "mobile.link.unavailable.description":
    "Ten link jest nieprawidłowy, nie jest już dostępny albo nie działa na telefonie.",
  "mobile.link.template.signInTitle": "Zaloguj się, aby dodać tego agenta",
  "mobile.link.template.signInDescription":
    "Zeskanuj kod QR w OpenBot na komputerze. Potem możesz przejrzeć agenta, zanim go dodasz.",
  "mobile.link.template.loading": "Wczytywanie agenta…",
  "mobile.link.template.creator": "Autor: {name}",
  "mobile.link.template.section.instructions": "Instrukcje",
  "mobile.link.template.section.skills": "Umiejętności",
  "mobile.link.template.section.noSkills": "Brak umiejętności.",
  "mobile.link.template.section.routines": "Rutyny",
  "mobile.link.template.section.noRoutines": "Brak rutyn.",
  "mobile.link.template.skill.local": "Lokalna umiejętność (tylko SKILL.md)",
  "mobile.link.template.skill.marketplace": "Umiejętność z Marketplace, wersja {version}",
  "mobile.link.template.server.title": "Dodaj do serwera",
  "mobile.link.template.server.footer":
    "Lista zawiera tylko serwery, na których jesteś właścicielem lub administratorem.",
  "mobile.link.template.server.updateRequired":
    "Zaktualizuj OpenBot na tym serwerze, aby dodawać udostępnionych agentów.",
  "mobile.link.template.server.none":
    "Aby dodać udostępnionego agenta, musisz być właścicielem lub administratorem serwera.",
  "mobile.link.template.install.action": "Dodaj agenta",
  "mobile.link.template.install.pending": "Dodawanie…",
  "mobile.link.template.install.failed": "Nie udało się dodać agenta.",
  "mobile.link.template.notFound.title": "Nie znaleziono agenta",
  "mobile.link.template.notFound.description":
    "Ten udostępniony agent nie istnieje albo jego autor wycofał publikację.",
  "mobile.link.template.error.title": "Nie udało się wczytać agenta",
  "mobile.link.template.error.loadFailed": "Nie udało się odczytać udostępnionego agenta. Spróbuj ponownie.",
  "mobile.link.template.error.unsupported":
    "Ten serwer nie może dodawać udostępnionych agentów. Zaktualizuj OpenBot na komputerze, na którym działa serwer.",
} as const satisfies PartialTranslation<typeof source>;
