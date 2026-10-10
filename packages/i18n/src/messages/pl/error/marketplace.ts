import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/marketplace";

export const messages = {
  "error.marketplace.timezoneInvalid": "Lokalna strefa czasowa jest nieprawidłowa.",
  "error.marketplace.installedAgentMissing": "Zainstalowany agent już nie istnieje.",
  "error.marketplace.differentListing": "Ten lokalny agent został zainstalowany z innego agenta z Marketplace.",
  "error.marketplace.marketplaceAvatarInvalid": "Awatar agenta z Marketplace jest nieprawidłowy.",
  "error.marketplace.shareCardInvalid": "Karta udostępniania jest nieprawidłowa.",
  "error.marketplace.cannotPublish": "Tego agenta nie można opublikować.",
  "error.marketplace.templateName": {
    one: "Nadaj temu agentowi nazwę o długości od 1 do {count} znaku.",
    few: "Nadaj temu agentowi nazwę o długości od 1 do {count} znaków.",
    many: "Nadaj temu agentowi nazwę o długości od 1 do {count} znaków.",
    other: "Nadaj temu agentowi nazwę o długości od 1 do {count} znaku.",
  },
  "error.marketplace.templateRole": {
    one: "Rola jest dłuższa niż {count} znak. Skróć ją.",
    few: "Rola jest dłuższa niż {count} znaki. Skróć ją.",
    many: "Rola jest dłuższa niż {count} znaków. Skróć ją.",
    other: "Rola jest dłuższa niż {count} znaku. Skróć ją.",
  },
  "error.marketplace.templateNoInstructions": "Dodaj instrukcje do tego agenta przed publikacją.",
  "error.marketplace.templateInstructions": {
    one: "Instrukcje są dłuższe niż {count} znak. Skróć je.",
    few: "Instrukcje są dłuższe niż {count} znaki. Skróć je.",
    many: "Instrukcje są dłuższe niż {count} znaków. Skróć je.",
    other: "Instrukcje są dłuższe niż {count} znaku. Skróć je.",
  },
  "error.marketplace.templateAvatar":
    "Awatar tego agenta jest nieprawidłowy. Wybierz go ponownie w ustawieniach agenta.",
  "error.marketplace.templateSkills": {
    one: "Agent może opublikować maksymalnie {count} umiejętność. Usuń część z nich.",
    few: "Agent może opublikować maksymalnie {count} umiejętności. Usuń część z nich.",
    many: "Agent może opublikować maksymalnie {count} umiejętności. Usuń część z nich.",
    other: "Agent może opublikować maksymalnie {count} umiejętności. Usuń część z nich.",
  },
  "error.marketplace.templateLocalSkills": {
    one: "Agent może opublikować maksymalnie {count} lokalną umiejętność. Usuń część z nich.",
    few: "Agent może opublikować maksymalnie {count} lokalne umiejętności. Usuń część z nich.",
    many: "Agent może opublikować maksymalnie {count} lokalnych umiejętności. Usuń część z nich.",
    other: "Agent może opublikować maksymalnie {count} lokalnej umiejętności. Usuń część z nich.",
  },
  "error.marketplace.templateSkill": "Nie można opublikować umiejętności „{name}”. Sprawdź jej nazwę i plik SKILL.md.",
  "error.marketplace.templateRoutines": {
    one: "Agent może opublikować maksymalnie {count} rutynę. Usuń część z nich.",
    few: "Agent może opublikować maksymalnie {count} rutyny. Usuń część z nich.",
    many: "Agent może opublikować maksymalnie {count} rutyn. Usuń część z nich.",
    other: "Agent może opublikować maksymalnie {count} rutyny. Usuń część z nich.",
  },
  "error.marketplace.templateRoutine": {
    one: "Rutyna „{name}” wymaga nazwy o długości do {count} znaku i instrukcji.",
    few: "Rutyna „{name}” wymaga nazwy o długości do {count} znaków i instrukcji.",
    many: "Rutyna „{name}” wymaga nazwy o długości do {count} znaków i instrukcji.",
    other: "Rutyna „{name}” wymaga nazwy o długości do {count} znaku i instrukcji.",
  },
  "error.marketplace.templateRoutineNoName": "bez nazwy",
  "error.marketplace.templateTooLarge":
    "Ten agent jest za duży, aby go opublikować. Skróć jego instrukcje, umiejętności lub rutyny.",
  "error.marketplace.linkInvalid": "Link do agenta jest nieprawidłowy.",
  "error.marketplace.changedSinceOpened":
    "Ten agent zmienił się po otwarciu. Otwórz link ponownie, aby przejrzeć nową wersję.",
  "error.marketplace.skillNameConflict":
    "Masz już inną lokalną umiejętność o nazwie „{name}”. Zmień jej nazwę lub ją usuń, a potem dodaj tego agenta ponownie.",
  "error.marketplace.avatarInvalid": "Awatar agenta jest nieprawidłowy.",
  "error.marketplace.secretInName": "Przed publikacją usuń sekret lub adres e-mail z nazwy.",
  "error.marketplace.secretInTitle": "Przed publikacją usuń sekret lub adres e-mail z tytułu.",
  "error.marketplace.secretInInstructions": "Przed publikacją usuń sekret lub adres e-mail z instrukcji.",
  "error.marketplace.secretInRoutine": "Przed publikacją usuń sekret lub adres e-mail z rutyny „{name}”.",
  "error.marketplace.secretInSkill": "Przed publikacją usuń sekret lub adres e-mail z umiejętności „{name}”.",
  "error.marketplace.catalogLoadFailed": "Nie udało się wczytać Marketplace. Spróbuj ponownie.",
  "error.marketplace.templateUnreadable":
    "Nie udało się odczytać tego udostępnionego agenta. Właściciel mógł go usunąć.",
} as const satisfies PartialTranslation<typeof source>;
