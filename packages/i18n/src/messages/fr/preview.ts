import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Aperçu du fichier",
  "preview.panel.resize": "Redimensionner l’aperçu du fichier",
  "preview.panel.openExternally": "Ouvrir le fichier dans une autre application",
  "preview.panel.download": "Télécharger le fichier",
  "preview.panel.reveal": "Afficher le fichier dans le Finder",
  "preview.panel.close": "Fermer l’aperçu du fichier",
  "preview.panel.back": "Retour",
  "preview.panel.rawMarkdown": "Afficher la source Markdown",
  "preview.panel.rawHtml": "Afficher la source HTML",
  "preview.panel.wrapLines": "Renvoyer les longues lignes à la ligne",
  "preview.folder.empty": "Ce dossier est vide.",
  "preview.folder.truncated": "Seuls les {limit} premiers éléments sont affichés.",
  "preview.truncated": "Aperçu tronqué après {limit} caractères.",
  "preview.unavailable": "Aperçu indisponible.",
  "preview.unsupported.title": "Aperçu indisponible",
  "preview.unsupported.description": "Vous pouvez ouvrir ce type de fichier dans son application par défaut.",
  "preview.unsupported.openExternally": "Ouvrir dans une autre application",
  "preview.spreadsheet.readFailed": "Impossible de lire cette feuille de calcul.",
  "preview.spreadsheet.truncated": "Aperçu limité aux {rows} premières lignes et aux {columns} premières colonnes.",
} as const satisfies PartialTranslation<typeof source>;
