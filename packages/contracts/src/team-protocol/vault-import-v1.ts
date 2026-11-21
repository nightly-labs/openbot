import { adminRoute, count, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const VAULT_IMPORT_CAPABILITY = "vault-import-v1";

export const VAULT_IMPORT_ROUTES = {
  import: "/v1/admin/vault/import",
} as const;

export const VAULT_IMPORT_CSV_LIMIT = 256 * 1024;

export const VAULT_IMPORT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    VAULT_IMPORT_ROUTES.import,
    adminRoute(fields({ csv: string(VAULT_IMPORT_CSV_LIMIT) }), fields({ imported: count, skipped: count })),
  ],
]);
