import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sharedTable";

export const messages = {
  "sharedTable.title": "Tables",
  "sharedTable.description":
    "Ce que les agents conservent entre les tâches, avec l’agent qui a commencé chaque ensemble d’enregistrements",
  "sharedTable.close": "Fermer les tables",
  "sharedTable.loading": "Chargement des tables…",
  "sharedTable.empty":
    "Aucune table pour le moment. Un agent en crée une lui-même quand une tâche a besoin d’enregistrements entre les tours, et chaque agent peut l’utiliser.",
  "sharedTable.loadFailed": "Impossible de charger les tables.",
  "sharedTable.deleteFailed": "Impossible de supprimer cet élément.",
  "sharedTable.madeOutside": "Créée hors d’OpenBot · n’importe quel agent peut la supprimer",
  "sharedTable.keptBy": "Conservée par {name}",
  "sharedTable.keptByDeleted": "Conservée par un agent qui n’existe plus",
  "sharedTable.deleteName": "Supprimer {name}",
  "sharedTable.confirmDelete":
    "Supprimer ceci pour tous les agents ? Les enregistrements ne pourront pas être récupérés.",
  "sharedTable.notCounted": "non compté",
  "sharedTable.records": { one: "{count} enregistrement", other: "{count} enregistrements" },
} as const satisfies PartialTranslation<typeof source>;
