import { fileURLToPath } from "node:url";

const I18N_SOURCE = normalizePath(fileURLToPath(new URL("./", import.meta.url)));
const EAGER_CATALOG_MODULES = new Set(["./app-catalogs", "./source-catalogs", "./format-catalogs", "./locale-loading"]);

/** The part of a Vite plugin that this plugin uses, so that this package needs no Vite dependency. */
interface LazyLanguageCatalogsPlugin {
  readonly name: string;
  readonly enforce: "pre";
  readonly applyToEnvironment?: (environment: { readonly name: string }) => boolean;
  resolveId(source: string, importer: string | undefined): string | null;
}

/**
 * A browser bundle loads English and each other language on first use (see `lazy-catalogs.ts`), not
 * all fifteen: all of them take about 36 MB of JavaScript heap in each window. A server or main
 * process bundle keeps every language.
 */
export function lazyLanguageCatalogs(options?: {
  /** Selects the Vite environments that load languages on first use. The default is all of them. */
  readonly applyToEnvironment?: (environment: { readonly name: string }) => boolean;
}): LazyLanguageCatalogsPlugin {
  return {
    name: "openbot-lazy-language-catalogs",
    enforce: "pre",
    ...(options?.applyToEnvironment ? { applyToEnvironment: options.applyToEnvironment } : {}),
    resolveId(source, importer) {
      if (!importer || !EAGER_CATALOG_MODULES.has(source)) return null;
      if (!normalizePath(importer).startsWith(I18N_SOURCE)) return null;
      return `${I18N_SOURCE}lazy-catalogs.ts`;
    },
  };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
