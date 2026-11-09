import type { VaultItemSummary, VaultLoginSummary, VaultState } from "@openbot/contracts/ipc";
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
import {
  VAULT_V3_CAPABILITY,
  VAULT_V3_ROUTES,
  VAULT_V3_WIRE_ITEM_LIMIT,
  VAULT_V3_WIRE_NAME_LIMIT,
} from "@openbot/contracts/team-protocol/vault-v3";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { decodeVaultSaveInput, decodeVaultSecretRequest } from "../vault-inputs";
import type { TeamApiVault } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, stringField } from "./request-helpers";

const V1_ROUTES: ReadonlySet<string> = new Set(Object.values(VAULT_ROUTES));
const V2_ROUTES: ReadonlySet<string> = new Set(Object.values(VAULT_V2_ROUTES));
const V3_ROUTES: ReadonlySet<string> = new Set(Object.values(VAULT_V3_ROUTES));

type VaultWireVersion = 1 | 2 | 3;

const WIRE = {
  1: { capability: VAULT_CAPABILITY, routes: VAULT_ROUTES, items: VAULT_WIRE_ITEM_LIMIT, name: VAULT_WIRE_NAME_LIMIT },
  2: {
    capability: VAULT_V2_CAPABILITY,
    routes: VAULT_V2_ROUTES,
    items: VAULT_V2_WIRE_ITEM_LIMIT,
    name: VAULT_V2_WIRE_NAME_LIMIT,
  },
  3: {
    capability: VAULT_V3_CAPABILITY,
    routes: VAULT_V3_ROUTES,
    items: VAULT_V3_WIRE_ITEM_LIMIT,
    name: VAULT_V3_WIRE_NAME_LIMIT,
  },
} as const;

function wireVersion(path: string): VaultWireVersion | null {
  if (V3_ROUTES.has(path)) return 3;
  if (V2_ROUTES.has(path)) return 2;
  return V1_ROUTES.has(path) ? 1 : null;
}

/** A list item as one wire version sends it. */
type WireItem = VaultItemSummary | Omit<VaultLoginSummary, "hasTwoStep">;

function wireItem(item: VaultItemSummary, version: VaultWireVersion): WireItem {
  const named = item.addedBy === undefined ? item : { ...item, addedBy: item.addedBy.slice(0, WIRE[version].name) };
  if (named.kind !== "login" || version === 3) return named;
  // `hasTwoStep` came with `vault-v3`; the item of an older version keeps its released shape.
  const { hasTwoStep: _hasTwoStep, ...released } = named;
  return released;
}

/**
 * The wire list, cut to the codec's bounds, so one long agent name cannot fail the list. `vault-v1`
 * has no API keys: its closed item list would refuse the whole answer.
 */
function wireState(state: VaultState, version: VaultWireVersion): { status: VaultState["status"]; items: WireItem[] } {
  return {
    status: state.status,
    items: state.items
      .filter((item) => version > 1 || item.kind !== "apiKey")
      .slice(0, WIRE[version].items)
      .map((item) => wireItem(item, version)),
  };
}

/**
 * The Vault of this host, which an owner or administrator manages from their own computer or browser.
 * Frozen by `vault-v1`, `vault-v2` and `vault-v3`. `vault-v2` and later list and change API keys;
 * only `vault-v3` changes two-step keys and answers two-step codes.
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
  const version = wireVersion(url.pathname);
  if (version === null) return "unmatched";
  if (!vault || !capabilities.has(WIRE[version].capability))
    throw new HttpError(400, sourceText("error.team.vaultUnsupported"));
  requireAdmin(member);
  // `readJson` has already run the body through the codec of the route's version. An older version's
  // codec drops `twoStepKey`, so its save keeps the saved key.
  const body = await readJson(request);
  const routes = WIRE[version].routes;
  const answer = (state: VaultState) => json(200, wireState(state, version));
  try {
    switch (url.pathname) {
      case routes.save:
        return answer(await runCauseEffect(vault.save(parse(() => decodeVaultSaveInput(body)))));
      case routes.delete: {
        const id = stringField(body, "id", false, 64);
        // A `vault-v1` client does not see API keys, so it cannot delete one.
        if (version === 1 && vault.state().items.some((item) => item.id === id && item.kind === "apiKey"))
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
      case VAULT_V3_ROUTES.codes:
        return json(200, await runCauseEffect(vault.codes()));
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
