import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/site";

export const messages = {
  "error.site.absolutePath": "Wybierz bezwzględną ścieżkę katalogu witryny.",
  "error.site.rootSymlink": "Dowiązania symboliczne nie są dozwolone w hostowanych witrynach.",
  "error.site.notDirectory": "Źródło witryny musi być katalogiem.",
  "error.site.outsideWorkspace": "Witryna musi znajdować się w obszarze roboczym tego agenta lub w OpenBot Shared.",
  "error.site.packageJsonInvalid": "Plik package.json witryny jest nieprawidłowy.",
  "error.site.astroServerOutput": "Astro musi używać wyjścia statycznego.",
  "error.site.astroAdapter": "Adaptery serwerowe Astro i integracja React nie są dozwolone.",
  "error.site.astroApiRoutes": "Trasy API Astro i akcje serwerowe nie są dozwolone.",
  "error.site.astroMiddleware": "Middleware Astro i kod serwerowy nie są dozwolone.",
  "error.site.astroNotBuilt": "Najpierw zbuduj projekt Astro. Wymagany jest istniejący katalog dist/.",
  "error.site.astroDistNotDirectory": "Astro dist/ musi być prawdziwym katalogiem.",
  "error.site.astroDistOutside": "Astro dist/ musi pozostać w katalogu projektu.",
  "error.site.directoryOutsideRoot": "Katalogi witryny muszą pozostać w katalogu źródłowym.",
  "error.site.siteTooLarge": "Witryna przekracza limit 2 MB.",
  "error.site.missingIndex": "Katalog główny witryny musi zawierać index.html.",
  "error.site.symlink": "Dowiązania symboliczne nie są dozwolone: {name}",
  "error.site.unsupportedEntry": "Nieobsługiwany element witryny: {name}",
  "error.site.tooManyFiles": "Witryna może zawierać maksymalnie {limit} plików.",
  "error.site.hiddenFile": "Ukryte pliki nie są dozwolone: {path}",
  "error.site.unsafePath": "Ta ścieżka pliku nie jest dozwolona: {path}",
  "error.site.secretFile": "Dane uwierzytelniające, klucze prywatne i kod serwerowy nie są dozwolone: {path}",
  "error.site.fileType": "Ten typ pliku nie jest dozwolony: {path}",
  "error.site.fileOutsideRoot": "Pliki witryny muszą pozostać w katalogu źródłowym: {path}",
  "error.site.fileTooLarge": "Plik przekracza limit 1 MB: {path}",
  "error.site.serverLimit": {
    one: "Ten serwer osiągnął limit {count} aktywnej witryny. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    few: "Ten serwer osiągnął limit {count} aktywnych witryn. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    many: "Ten serwer osiągnął limit {count} aktywnych witryn. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    other:
      "Ten serwer osiągnął limit {count} aktywnej witryny. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
  },
  "error.site.unlinkedLimit": {
    one: "Ten komputer nie jest serwerem, a jego konto osiągnęło limit {count} aktywnej witryny. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    few: "Ten komputer nie jest serwerem, a jego konto osiągnęło limit {count} aktywnych witryn. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    many: "Ten komputer nie jest serwerem, a jego konto osiągnęło limit {count} aktywnych witryn. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
    other:
      "Ten komputer nie jest serwerem, a jego konto osiągnęło limit {count} aktywnej witryny. Aby opublikować kolejną witrynę, usuń witrynę lub użyj serwera w chmurze z planem, który ma więcej witryn.",
  },
} as const satisfies PartialTranslation<typeof source>;
