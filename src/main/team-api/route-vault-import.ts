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

export async function routeVaultImport(
  context: TeamApiRequestContext,
  vault: TeamApiVault | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST" || url.pathname !== VAULT_IMPORT_ROUTES.import) return "unmatched";
  if (!vault || !capabilities.has(VAULT_IMPORT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.vaultUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  try {
    const result = await runCauseEffect(vault.importCsv(stringField(body, "csv", false, VAULT_IMPORT_CSV_LIMIT)));
    return json(200, { imported: result.imported, skipped: result.skipped });
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError) && isFixedSourceText(error.message))
      throw new HttpError(400, error.message);
    throw error;
  }
}
