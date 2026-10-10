import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Scegli un percorso assoluto per la cartella del sito.",
  "error.site.rootSymlink": "I link simbolici non sono consentiti nei siti ospitati.",
  "error.site.notDirectory": "L'origine del sito deve essere una cartella.",
  "error.site.outsideWorkspace": "Il sito deve trovarsi nel workspace di questo agente o in OpenBot Shared.",
  "error.site.packageJsonInvalid": "Il package.json del sito non è valido.",
  "error.site.astroServerOutput": "Astro deve usare l'output statico.",
  "error.site.astroAdapter": "Gli adattatori server di Astro e l'integrazione React non sono consentiti.",
  "error.site.astroApiRoutes": "Le route API e le server action di Astro non sono consentite.",
  "error.site.astroMiddleware": "Il middleware e il codice server di Astro non sono consentiti.",
  "error.site.astroNotBuilt": "Esegui prima la build del progetto Astro. Serve la sua cartella dist/ esistente.",
  "error.site.astroDistNotDirectory": "La dist/ di Astro deve essere una vera cartella.",
  "error.site.astroDistOutside": "La dist/ di Astro deve restare dentro la cartella del progetto.",
  "error.site.directoryOutsideRoot": "Le cartelle del sito devono restare dentro la radice dell'origine.",
  "error.site.siteTooLarge": "Il sito supera il limite di 2 MB.",
  "error.site.missingIndex": "La radice del sito deve contenere index.html.",
  "error.site.symlink": "I link simbolici non sono consentiti: {name}",
  "error.site.unsupportedEntry": "Elemento del sito non supportato: {name}",
  "error.site.tooManyFiles": "Un sito può contenere al massimo {limit} file.",
  "error.site.hiddenFile": "I file nascosti non sono consentiti: {path}",
  "error.site.unsafePath": "Questo percorso di file non è consentito: {path}",
  "error.site.secretFile": "Credenziali, chiavi private e codice server non sono consentiti: {path}",
  "error.site.fileType": "Questo tipo di file non è consentito: {path}",
  "error.site.fileOutsideRoot": "I file del sito devono restare dentro la radice dell'origine: {path}",
  "error.site.fileTooLarge": "Un file supera il limite di 1 MB: {path}",
} as const satisfies PartialTranslation<typeof source>;
