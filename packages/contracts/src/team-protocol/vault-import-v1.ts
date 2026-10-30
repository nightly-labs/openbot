// Frozen optional vault-import-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants: an owner or admin of a joined server sends the text of a CSV password export to the
// host, and the host adds its logins to its Vault, as from its own file dialog. It widens `vault-v1`,
// which has no import because that reads a file on the host. A member cannot use the route;
// `requireAdmin` on the host is the only gate.
//
// The request carries the CSV text once, at most `VAULT_IMPORT_CSV_LIMIT` characters, so it stays
// below the host's 1 MiB JSON body limit. The answer carries only the counts: no password, and no
// list. The client reads the list again with `vault-v1`. The host answers a file that is not a
// password export with the Vault's own sentence.
import { adminRoute, count, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const VAULT_IMPORT_CAPABILITY = "vault-import-v1";

export const VAULT_IMPORT_ROUTES = {
  import: "/v1/admin/vault/import",
} as const;

/** The characters of one CSV export. A request stays below the 1 MiB JSON body limit. */
export const VAULT_IMPORT_CSV_LIMIT = 256 * 1024;

export const VAULT_IMPORT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    VAULT_IMPORT_ROUTES.import,
    adminRoute(fields({ csv: string(VAULT_IMPORT_CSV_LIMIT) }), fields({ imported: count, skipped: count })),
  ],
]);
