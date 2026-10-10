import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Memorie",
  "memory.description": "Memorie salvate per {name}",
  "memory.add": "Aggiungi memoria",
  "memory.close": "Chiudi memorie",
  "memory.new": "Nuova memoria",
  "memory.newPlaceholder": "Aggiungi un fatto o una preferenza duratura",
  "memory.save": "Salva memoria",
  "memory.limitAgent":
    "Questo agente ha raggiunto il limite di {limit} memorie. Modifica, unisci o elimina una memoria prima di aggiungerne un'altra.",
  "memory.limitChannel":
    "Questo canale ha raggiunto il limite di {limit} memorie. Modifica, unisci o elimina una memoria prima di aggiungerne un'altra.",
  "memory.loading": "Caricamento delle memorie…",
  "memory.emptyAgent": "Questo agente non ha ancora memorie salvate.",
  "memory.emptyChannel": "Questo canale non ha ancora memorie salvate.",
  "memory.editText": "Modifica memoria: {text}",
  "memory.edit": "Modifica memoria",
  "memory.delete": "Elimina memoria",
  "memory.learned": "Appresa automaticamente",
  "memory.manual": "Aggiunta a mano",
  "memory.unknownDate": "Data sconosciuta",
  "memory.clearAll": "Cancella tutte le memorie",
  "memory.clearTitle": "Cancellare tutte le memorie?",
  "memory.clearDescription":
    "OpenBot rimuoverà definitivamente tutte le {total} memorie salvate per {name}. I messaggi originali resteranno nella cronologia della conversazione.",

  "memory.loadFailed": "Impossibile caricare le memorie.",
  "memory.saveFailed": "Impossibile salvare la memoria.",
  "memory.updateFailed": "Impossibile aggiornare la memoria.",
  "memory.deleteFailed": "Impossibile eliminare la memoria.",
  "memory.clearFailed": "Impossibile cancellare le memorie.",
  "memory.inclusion.label": "Uso della memoria",
  "memory.inclusion.essential": "Sempre inclusa",
  "memory.inclusion.searchable": "Cerca quando serve",
  "memory.inclusion.automatic": "Decide l'agente",
  "memory.inclusion.userControlled": "Scelta da te",
  "memory.inclusion.agentControlled": "L'agente può cambiarla",
  "memory.inclusion.explanation":
    "Tutte le memorie restano salvate. Solo quelle essenziali entrano in ogni prompt. L'agente può cercare le altre.",
  "memory.inclusion.capacity": "Capacità della memoria essenziale: {used} su {total}",
} as const satisfies PartialTranslation<typeof source>;
