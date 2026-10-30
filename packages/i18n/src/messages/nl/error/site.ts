import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Kies een absoluut pad naar de sitemap.",
  "error.site.rootSymlink": "Symlinks zijn niet toegestaan in gehoste sites.",
  "error.site.notDirectory": "De bron van de site moet een map zijn.",
  "error.site.outsideWorkspace": "De site moet in de werkruimte van deze agent of in OpenBot Shared staan.",
  "error.site.packageJsonInvalid": "De package.json van de site is ongeldig.",
  "error.site.astroServerOutput": "Astro moet statische output gebruiken.",
  "error.site.astroAdapter": "Serveradapters voor Astro en React-integratie zijn niet toegestaan.",
  "error.site.astroApiRoutes": "API-routes en serveracties van Astro zijn niet toegestaan.",
  "error.site.astroMiddleware": "Middleware en serverbroncode van Astro zijn niet toegestaan.",
  "error.site.astroNotBuilt": "Bouw eerst het Astro-project. De bestaande map dist/ is verplicht.",
  "error.site.astroDistNotDirectory": "Astro dist/ moet een echte map zijn.",
  "error.site.astroDistOutside": "Astro dist/ moet in de projectmap blijven.",
  "error.site.directoryOutsideRoot": "Sitemappen moeten in de hoofdmap van de bron blijven.",
  "error.site.siteTooLarge": "De site is groter dan de limiet van 2 MB.",
  "error.site.missingIndex": "De hoofdmap van de site moet index.html bevatten.",
  "error.site.symlink": "Symlinks zijn niet toegestaan: {name}",
  "error.site.unsupportedEntry": "Niet-ondersteund item in de site: {name}",
  "error.site.tooManyFiles": "Een site kan maximaal {limit} bestanden bevatten.",
  "error.site.hiddenFile": "Verborgen bestanden zijn niet toegestaan: {path}",
  "error.site.unsafePath": "Dit bestandspad is niet toegestaan: {path}",
  "error.site.secretFile": "Inloggegevens, privésleutels en serverbroncode zijn niet toegestaan: {path}",
  "error.site.fileType": "Dit bestandstype is niet toegestaan: {path}",
  "error.site.fileOutsideRoot": "Sitebestanden moeten in de hoofdmap van de bron blijven: {path}",
  "error.site.fileTooLarge": "Een bestand is groter dan de limiet van 1 MB: {path}",
  "error.site.serverLimit": {
    one: "Deze server heeft de limiet van {count} actieve site bereikt. Verwijder een site of gebruik een cloudserver met een abonnement met meer sites om nog een site te publiceren.",
    other:
      "Deze server heeft de limiet van {count} actieve sites bereikt. Verwijder een site of gebruik een cloudserver met een abonnement met meer sites om nog een site te publiceren.",
  },
  "error.site.unlinkedLimit": {
    one: "Deze computer is geen server, en het account heeft de limiet van {count} actieve site bereikt. Verwijder een site of gebruik een cloudserver met een abonnement met meer sites om nog een site te publiceren.",
    other:
      "Deze computer is geen server, en het account heeft de limiet van {count} actieve sites bereikt. Verwijder een site of gebruik een cloudserver met een abonnement met meer sites om nog een site te publiceren.",
  },
} as const satisfies PartialTranslation<typeof source>;
