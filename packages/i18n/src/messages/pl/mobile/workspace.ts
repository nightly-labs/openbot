import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/workspace";

export const messages = {
  "mobile.workspace.status.notConnected": "Nie połączono",
  "mobile.workspace.status.online": "Online",
  "mobile.workspace.status.offline": "Offline",
  "mobile.workspace.status.error": "Błąd połączenia",
  "mobile.workspace.status.reconnecting": "Ponowne łączenie",
  "mobile.workspace.status.attempt": "Próba {attempt}/{limit}",
  "mobile.workspace.status.attemptPrefix": "Próba ",
  "mobile.workspace.status.retryIn": "Ponowna próba za {seconds} s",
  "mobile.workspace.section.agents": "Agenci",
  "mobile.workspace.error.directoryUnavailable": "Katalog serwerów jest niedostępny.",
  "mobile.workspace.error.sectionsLoadFailed": "Nie udało się wczytać sekcji. Spróbuj ponownie.",
  "mobile.workspace.error.transportNotReady": "Transport mobilny nie jest gotowy.",
  "mobile.workspace.error.sectionsUnsupported": "Ten host nie obsługuje zmian sekcji.",
  "mobile.workspace.error.leaveOwnServer": "Można opuścić tylko dołączone serwery zdalne.",
  "mobile.workspace.error.removeOwnedServerOnly": "Tylko właściciel może usunąć ten serwer.",
  "mobile.workspace.error.agentNotOnHost": "Agenta nie ma na tym hoście.",
  "mobile.workspace.error.filesUnsupported":
    "Ten host nie obsługuje zarządzania plikami. Zaktualizuj OpenBot na hoście.",
  "mobile.workspace.error.agentUnavailableOnHost": "Agent jest niedostępny na tym hoście.",
  "mobile.workspace.error.agentUnavailable": "Agent jest niedostępny.",
  "mobile.workspace.error.formUnavailable": "Ten formularz nie jest już dostępny.",
  "mobile.workspace.error.approvalInactive":
    "To żądanie już nie czeka. Odpowiedziało na nie inne urządzenie albo zadanie zostało zatrzymane.",
  "mobile.workspace.error.approvalOffline": "Połącz się z serwerem, aby odpowiedzieć na to żądanie.",
  "mobile.workspace.alert.preferencesTitle": "Nie udało się zapisać preferencji czatu",
  "mobile.workspace.alert.preferencesBody": "Poprzednie preferencje zostały zachowane. Spróbuj ponownie.",
  "mobile.workspace.alert.updateRequiredTitle": "Wymagana aktualizacja",
  "mobile.workspace.alert.updateRequiredUnread":
    "Zaktualizuj ten serwer na komputerze, aby oznaczać rozmowy jako nieprzeczytane.",
  "mobile.workspace.alert.markUnreadTitle": "Nie udało się oznaczyć jako nieprzeczytane",
  "mobile.workspace.alert.markUnreadBody": "Połącz się ponownie z serwerem i spróbuj jeszcze raz.",
  "mobile.workspace.alert.markAllReadTitle": "Nie udało się oznaczyć wszystkich jako przeczytane",
  "mobile.workspace.alert.markAllReadBody":
    "Niektóre czaty są nadal nieprzeczytane. Połącz się ponownie z serwerem i spróbuj jeszcze raz.",
  "mobile.workspace.alert.serverOrderTitle": "Nie udało się zapisać kolejności serwerów",
  "mobile.workspace.alert.serverOrderBody": "Poprzednia kolejność została zachowana. Spróbuj ponownie.",
  "mobile.workspace.error.connectFailed": "Połączenie z serwerem nie powiodło się.",
  "mobile.workspace.error.disconnectFailed": "Serwer nie rozłączył się poprawnie.",
  "mobile.workspace.error.queueEditRejected": "Host nie przyjął tej zmiany.",
} as const satisfies PartialTranslation<typeof source>;
