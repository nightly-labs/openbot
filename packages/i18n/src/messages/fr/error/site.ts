import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  // Hosted site errors.
  "error.site.absolutePath": "Choisissez un chemin absolu pour le dossier du site.",
  "error.site.rootSymlink": "Les liens symboliques ne sont pas autorisés dans les sites hébergés.",
  "error.site.notDirectory": "La source du site doit être un dossier.",
  "error.site.outsideWorkspace":
    "Le site doit se trouver dans l’espace de travail de cet agent ou dans OpenBot Shared.",
  "error.site.packageJsonInvalid": "Le fichier package.json du site n’est pas valide.",
  "error.site.astroServerOutput": "Astro doit utiliser une sortie statique.",
  "error.site.astroAdapter": "Les adaptateurs serveur Astro et l’intégration React ne sont pas autorisés.",
  "error.site.astroApiRoutes": "Les routes d’API et les actions serveur Astro ne sont pas autorisées.",
  "error.site.astroMiddleware": "Le middleware Astro et le code source serveur ne sont pas autorisés.",
  "error.site.astroNotBuilt": "Compilez d’abord le projet Astro. Son dossier dist/ existant est nécessaire.",
  "error.site.astroDistNotDirectory": "Le dossier dist/ d’Astro doit être un vrai dossier.",
  "error.site.astroDistOutside": "Le dossier dist/ d’Astro doit rester dans le dossier du projet.",
  "error.site.directoryOutsideRoot": "Les dossiers du site doivent rester dans la racine source.",
  "error.site.siteTooLarge": "Le site dépasse la limite de 2 Mo.",
  "error.site.missingIndex": "La racine du site doit contenir index.html.",
  "error.site.symlink": "Les liens symboliques ne sont pas autorisés : {name}",
  "error.site.unsupportedEntry": "Élément de site non pris en charge : {name}",
  "error.site.tooManyFiles": "Un site peut contenir au maximum {limit} fichiers.",
  "error.site.hiddenFile": "Les fichiers masqués ne sont pas autorisés : {path}",
  "error.site.secretFile":
    "Les identifiants, les clés privées et le code source serveur ne sont pas autorisés : {path}",
  "error.site.fileType": "Ce type de fichier n’est pas autorisé : {path}",
  "error.site.fileOutsideRoot": "Les fichiers du site doivent rester dans la racine source : {path}",
  "error.site.fileTooLarge": "Un fichier dépasse la limite de 1 Mo : {path}",
} as const satisfies PartialTranslation<typeof source>;
