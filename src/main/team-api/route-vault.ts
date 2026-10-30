import type { VaultState } from "@openbot/contracts/ipc";
import {
  VAULT_CAPABILITY,
  VAULT_ROUTES,
  VAULT_WIRE_ITEM_LIMIT,
  VAULT_WIRE_NAME_LIMIT,
} from "@openbot/contracts/team-protocol/vault-v1";
import {
  VAULT_V2_CAPABILITY,
  VAULT_V2_ROUTES,
  VAULT_V2_WIRE_ITEM_LIMIT,
  VAULT_V2_WIRE_NAME_LIMIT,
} from "@openbot/contracts/team-protocol/vault-v2";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeVaultSaveInput, decodeVaultSecretRequest } from "../vault-inputs";
import type { TeamApiVault } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const V1_ROUTES: ReadonlySet<string> = new Set(Object.values(VAULT_ROUTES));
const V2_ROUTES: ReadonlySet<string> = new Set(Object.values(VAULT_V2_ROUTES));

/**
 * The wire list, cut to the codec's bounds, so one long agent name cannot fail the list. `vault-v1`
 * has no API keys: its closed item list would refuse the whole answer.
 */
function wireState(state: VaultState, v2: boolean): VaultState {
  const nameLimit = v2 ? VAULT_V2_WIRE_NAME_LIMIT : VAULT_WIRE_NAME_LIMIT;
  return {
    status: state.status,
    items: state.items
      .filter((item) => v2 || item.kind !== "apiKey")
      .slice(0, v2 ? VAULT_V2_WIRE_ITEM_LIMIT : VAULT_WIRE_ITEM_LIMIT)
      .map((item) => (item.addedBy === undefined ? item : { ...item, addedBy: item.addedBy.slice(0, nameLimit) })),
  };
}

/**
 * The Vault of this host, which an owner or administrator manages from their own computer or browser.
 * Frozen by `vault-v1` and `vault-v2`; only `vault-v2` lists and changes API keys.
 *
 * A list never carries a password, a card number, a security code or an API key; `reveal` answers one
 * for the user who asked to see or copy it. `requireAdmin` runs on every route.
 */
export async function routeVault(
  context: TeamApiRequestContext,
  vault: TeamApiVault | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (method !== "POST") return "unmatched";
  const v2 = V2_ROUTES.has(url.pathname);
  if (!v2 && !V1_ROUTES.has(url.pathname)) return "unmatched";
  if (!vault || !capabilities.has(v2 ? VAULT_V2_CAPABILITY : VAULT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.vaultUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the codec of the route's version.
  const body = await readJson(request);
  const routes = v2 ? VAULT_V2_ROUTES : VAULT_ROUTES;
  const answer = (state: VaultState) => json(200, wireState(state, v2));
  try {
    switch (url.pathname) {
      case routes.save:
        return answer(await runCauseEffect(vault.save(parse(() => decodeVaultSaveInput(body)))));
      case routes.delete: {
        const id = stringField(body, "id", false, 64);
        // A `vault-v1` client does not see API keys, so it cannot delete one.
        if (!v2 && vault.state().items.some((item) => item.id === id && item.kind === "apiKey"))
          throw new HttpError(400, sourceText("error.vault.itemMissing"));
        return answer(await runCauseEffect(vault.delete(id)));
      }
      case routes.reveal:
        return json(200, { value: vault.reveal(parse(() => decodeVaultSecretRequest(body))) });
      case routes.reset:
        // Only the way out of a file that the host cannot read: a readable Vault is never deleted here.
        if (vault.state().status !== "unreadable")
          throw new HttpError(409, sourceText("error.team.vaultResetReadable"));
        return answer(await runCauseEffect(vault.reset()));
      default:
        return answer(vault.state());
    }
  } catch (error) {
    // A value typed wrong, a missing item or a Vault that cannot be read is catalog text for the
    // admin. Any other failure stays private: the server answers it with its generic error.
    if (error instanceof Error && !(error instanceof HttpError) && isFixedSourceText(error.message))
      throw new HttpError(400, error.message);
    throw error;
  }
}

function parse<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid Vault request.");
  }
}
