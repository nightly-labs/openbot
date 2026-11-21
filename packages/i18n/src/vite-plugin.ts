import { fileURLToPath } from "node:url";

const I18N_SOURCE = normalizePath(fileURLToPath(new URL("./", import.meta.url)));
const EAGER_CATALOG_MODULES = new Set(["./app-catalogs", "./source-catalogs", "./format-catalogs", "./locale-loading"]);

interface LazyLanguageCatalogsPlugin {
  readonly name: string;
  readonly enforce: "pre";
  readonly applyToEnvironment?: (environment: { readonly name: string }) => boolean;
  resolveId(source: string, importer: string | undefined): string | null;
}

export function lazyLanguageCatalogs(options?: {
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
