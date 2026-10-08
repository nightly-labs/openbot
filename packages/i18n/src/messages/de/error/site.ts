import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Wähle einen absoluten Pfad zum Website-Verzeichnis.",
  "error.site.rootSymlink": "In gehosteten Websites sind keine symbolischen Links erlaubt.",
  "error.site.notDirectory": "Die Website-Quelle muss ein Verzeichnis sein.",
  "error.site.outsideWorkspace": "Die Website muss im Arbeitsbereich dieses Agenten oder in OpenBot Shared liegen.",
  "error.site.packageJsonInvalid": "Die package.json der Website ist ungültig.",
  "error.site.astroServerOutput": "Astro muss statische Ausgabe verwenden.",
  "error.site.astroAdapter": "Astro-Serveradapter und die React-Integration sind nicht erlaubt.",
  "error.site.astroApiRoutes": "Astro-API-Routen und Serveraktionen sind nicht erlaubt.",
  "error.site.astroMiddleware": "Astro-Middleware und Serverquellcode sind nicht erlaubt.",
  "error.site.astroNotBuilt":
    "Erstelle zuerst den Build des Astro-Projekts. Sein vorhandenes Verzeichnis dist/ wird benötigt.",
  "error.site.astroDistNotDirectory": "Astro dist/ muss ein echtes Verzeichnis sein.",
  "error.site.astroDistOutside": "Astro dist/ muss innerhalb des Projektverzeichnisses bleiben.",
  "error.site.directoryOutsideRoot": "Website-Verzeichnisse müssen innerhalb des Quellverzeichnisses bleiben.",
  "error.site.siteTooLarge": "Die Website überschreitet die Grenze von 2 MB.",
  "error.site.missingIndex": "Das Stammverzeichnis der Website muss index.html enthalten.",
  "error.site.symlink": "Symbolische Links sind nicht erlaubt: {name}",
  "error.site.unsupportedEntry": "Nicht unterstützter Website-Eintrag: {name}",
  "error.site.tooManyFiles": "Eine Website kann höchstens {limit} Dateien enthalten.",
  "error.site.hiddenFile": "Versteckte Dateien sind nicht erlaubt: {path}",
  "error.site.unsafePath": "Dieser Dateipfad ist nicht erlaubt: {path}",
  "error.site.secretFile": "Zugangsdaten, private Schlüssel und Serverquellcode sind nicht erlaubt: {path}",
  "error.site.fileType": "Dieser Dateityp ist nicht erlaubt: {path}",
  "error.site.fileOutsideRoot": "Website-Dateien müssen innerhalb des Quellverzeichnisses bleiben: {path}",
  "error.site.fileTooLarge": "Eine Datei überschreitet die Grenze von 1 MB: {path}",
} as const satisfies PartialTranslation<typeof source>;
