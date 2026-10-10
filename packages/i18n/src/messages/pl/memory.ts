import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Wspomnienia",
  "memory.description": "Zapisane wspomnienia: {name}",
  "memory.add": "Dodaj wspomnienie",
  "memory.close": "Zamknij wspomnienia",
  "memory.new": "Nowe wspomnienie",
  "memory.newPlaceholder": "Dodaj trwały fakt lub preferencję",
  "memory.save": "Zapisz wspomnienie",
  "memory.limitAgent":
    "Ten agent osiągnął limit wspomnień ({limit}). Edytuj, scal lub usuń wspomnienie, zanim dodasz kolejne.",
  "memory.limitChannel":
    "Ten kanał osiągnął limit wspomnień ({limit}). Edytuj, scal lub usuń wspomnienie, zanim dodasz kolejne.",
  "memory.loading": "Wczytywanie wspomnień…",
  "memory.emptyAgent": "Ten agent nie ma jeszcze zapisanych wspomnień.",
  "memory.emptyChannel": "Ten kanał nie ma jeszcze zapisanych wspomnień.",
  "memory.editText": "Edytuj wspomnienie: {text}",
  "memory.edit": "Edytuj wspomnienie",
  "memory.delete": "Usuń wspomnienie",
  "memory.learned": "Zapamiętane automatycznie",
  "memory.manual": "Dodane ręcznie",
  "memory.unknownDate": "Nieznana data",
  "memory.clearAll": "Wyczyść wszystkie wspomnienia",
  "memory.clearTitle": "Wyczyścić wszystkie wspomnienia?",
  "memory.clearDescription":
    "OpenBot trwale usunie wszystkie zapisane wspomnienia ({total}) dla: {name}. Oryginalne wiadomości pozostaną w historii rozmowy.",
  "memory.loadFailed": "Nie udało się wczytać wspomnień.",
  "memory.saveFailed": "Nie udało się zapisać wspomnienia.",
  "memory.updateFailed": "Nie udało się zaktualizować wspomnienia.",
  "memory.deleteFailed": "Nie udało się usunąć wspomnienia.",
  "memory.clearFailed": "Nie udało się wyczyścić wspomnień.",
  "memory.inclusion.label": "Użycie pamięci",
  "memory.inclusion.essential": "Zawsze dołączane",
  "memory.inclusion.searchable": "Wyszukuj w razie potrzeby",
  "memory.inclusion.automatic": "Niech agent zdecyduje",
  "memory.inclusion.userControlled": "Wybrane przez ciebie",
  "memory.inclusion.agentControlled": "Agent może to zmienić",
  "memory.inclusion.explanation":
    "Wszystkie wspomnienia pozostają zapisane. Tylko kluczowe wspomnienia trafiają do każdego promptu. Pozostałe agent może przeszukiwać.",
  "memory.inclusion.capacity": "Pojemność kluczowej pamięci: {used} z {total}",
} as const satisfies PartialTranslation<typeof source>;
