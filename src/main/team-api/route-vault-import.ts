import {
  VAULT_IMPORT_CAPABILITY,
  VAULT_IMPORT_CSV_LIMIT,
  VAULT_IMPORT_ROUTES,
} from "@openbot/contracts/team-protocol/vault-import-v1";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiVault } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

/**
 * Adds the logins of a CSV password export that an owner or administrator sends from another device,
 * as the host's own file dialog does. Frozen by `vault-import-v1`.
 *
 * `requireAdmin` runs first. The Vault registers each imported password for log redaction when it
 * stores it. The answer carries only the counts.
 */
export async function routeVaultImport(
  context: TeamApiRequestContext,
  vault: TeamApiVault | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== VAULT_IMPORT_ROUTES.import) return "unmatched";
  if (!vault || !capabilities.has(VAULT_IMPORT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.vaultUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the `vault-import-v1` codec.
  const body = await readJson(request);
  try {
    const result = await runCauseEffect(vault.importCsv(stringField(body, "csv", false, VAULT_IMPORT_CSV_LIMIT)));
    return json(200, { imported: result.imported, skipped: result.skipped });
  } catch (error) {
    // A file that is not a password export, or a Vault that cannot be changed, is catalog text for the
    // admin. Any other failure stays private: the server answers it with its generic error.
    if (error instanceof Error && !(error instanceof HttpError) && isFixedSourceText(error.message))
      throw new HttpError(400, error.message);
    throw error;
  }
}
