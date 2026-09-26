import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/memory";

export const messages = {
  "memory.title": "Souvenirs",
  "memory.description": "Souvenirs enregistrés pour {name}",
  "memory.add": "Ajouter un souvenir",
  "memory.close": "Fermer les souvenirs",
  "memory.new": "Nouveau souvenir",
  "memory.newPlaceholder": "Ajoutez un fait ou une préférence durable",
  "memory.save": "Enregistrer le souvenir",
  "memory.limitAgent":
    "Cet agent a atteint la limite de {limit} souvenirs. Modifiez, fusionnez ou supprimez un souvenir avant d’en ajouter un autre.",
  "memory.limitChannel":
    "Ce canal a atteint la limite de {limit} souvenirs. Modifiez, fusionnez ou supprimez un souvenir avant d’en ajouter un autre.",
  "memory.loading": "Chargement des souvenirs…",
  "memory.emptyAgent": "Cet agent n’a encore aucun souvenir enregistré.",
  "memory.emptyChannel": "Ce canal n’a encore aucun souvenir enregistré.",
  "memory.editText": "Modifier le souvenir : {text}",
  "memory.edit": "Modifier le souvenir",
  "memory.delete": "Supprimer le souvenir",
  "memory.learned": "Appris automatiquement",
  "memory.manual": "Ajouté manuellement",
  "memory.unknownDate": "Date inconnue",
  "memory.clearAll": "Effacer tous les souvenirs",
  "memory.clearTitle": "Effacer tous les souvenirs ?",
  "memory.clearDescription":
    "OpenBot va supprimer définitivement les {total} souvenirs enregistrés pour {name}. Les messages d’origine resteront dans l’historique de la conversation.",

  "memory.loadFailed": "Impossible de charger les souvenirs.",
  "memory.saveFailed": "Impossible d’enregistrer le souvenir.",
  "memory.updateFailed": "Impossible de mettre à jour le souvenir.",
  "memory.deleteFailed": "Impossible de supprimer le souvenir.",
  "memory.clearFailed": "Impossible d’effacer les souvenirs.",
} as const satisfies PartialTranslation<typeof source>;
