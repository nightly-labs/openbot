import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/preview";

export const messages = {
  "preview.panel.label": "Aperçu du fichier",
  "preview.panel.resize": "Redimensionner l’aperçu du fichier",
  "preview.panel.copy": "Copier le texte",
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
  "preview.unsupported.openExternally": "Ouvrir en externe",
  "preview.tooLarge.title": "Fichier trop volumineux pour l'aperçu",
  "preview.tooLarge.description":
    "L'aperçu s'arrête à 100 Mo. Vous pouvez ouvrir ce fichier dans son application par défaut.",
  "preview.spreadsheet.readFailed": "Impossible de lire cette feuille de calcul.",
  "preview.spreadsheet.tooLarge":
    "Cette feuille de calcul est trop volumineuse pour l’aperçu. Ouvrez ou téléchargez le fichier pour tout voir.",
  "preview.spreadsheet.truncated": "Aperçu limité aux {rows} premières lignes et aux {columns} premières colonnes.",
  "preview.document.readFailed": "Impossible de lire ce document.",
  "preview.document.empty": "Ce document ne contient aucun texte à afficher.",
  "preview.document.truncated": "Aperçu limité à la première partie du document.",
} as const satisfies PartialTranslation<typeof source>;
