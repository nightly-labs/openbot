import {
  decodeHostVaultCodes,
  decodeHostVaultSecret,
  decodeHostVaultState,
  type VaultSaveInput,
} from "@openbot/contracts/ipc";
import { VAULT_IMPORT_CSV_LIMIT } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_ROUTES } from "@openbot/contracts/team-protocol/vault-v3";
import { VAULT_V4_ROUTES } from "@openbot/contracts/team-protocol/vault-v4";
import { runTeamEffect } from "@openbot/team-client";
import { importHostVaultCsv } from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import { remoteVaultCalls, type VaultCalls } from "../vault/vault-port";
import { chooseFiles } from "./web-channels-runtime";
import type { WebWorkspace } from "./web-client-context";

/**
 * The Vault of the connected host (`vault-v4`, `vault-v3` without the agents of each item, `vault-v2`
 * without two-step keys, or `vault-v1` without API keys), for its owner or admin. The browser has no main process, so a copy shows the secret to this page and puts it on the
 * clipboard here. `importable` is true while the host serves `vault-import-v1`: the browser's file
 * chooser picks the CSV export, and its text goes to the host.
 */
export function webVaultCalls(
  request: () => TeamApiRequest,
  onHostEvent: WebWorkspace["onHostEvent"],
  version: 1 | 2 | 3 | 4,
  importable = false,
): VaultCalls {
  const routes =
    version === 4 ? VAULT_V4_ROUTES : version === 3 ? VAULT_V3_ROUTES : version === 2 ? VAULT_V2_ROUTES : VAULT_ROUTES;
  const state = (value: unknown) => decodeHostVaultState(value, version === 4);
  const post = <T>(path: string, decode: (value: unknown) => T, body: Parameters<TeamApiRequest>[3] = {}) =>
    request()("POST", path, decode, body);
  const reveal: VaultCalls["reveal"] = (secret) => post(routes.reveal, decodeHostVaultSecret, { ...secret });
  /** The answer has only the counts, so the list is read again, as on the desktop. A closed chooser gives null. */
  const importCsv = async () => {
    // The host is checked before the chooser opens, and nothing is awaited before it.
    const send = request();
    const [file] = await chooseFiles({ multiple: false, accept: ".csv,text/csv" });
    if (!file) return null;
    // Each character takes at least one byte, so a larger file cannot fit.
    if (file.size > VAULT_IMPORT_CSV_LIMIT * 4) throw new Error(currentText().t("error.vault.csvTooLarge"));
    const csv = await file.text();
    if (csv.length > VAULT_IMPORT_CSV_LIMIT) throw new Error(currentText().t("error.vault.csvTooLarge"));
    const { imported, skipped } = await runTeamEffect(
      importHostVaultCsv(send, csv).pipe(Effect.mapError((error) => error.cause)),
    );
    return { imported, skipped, state: await send("POST", routes.list, state, {}) };
  };
  return remoteVaultCalls(
    {
      list: () => post(routes.list, state),
      save: (input) => post(routes.save, state, saveBody(input)),
      remove: (id) => post(routes.delete, state, { id }),
      reveal,
      // The write starts in the click, with the value still on its way: Safari refuses a clipboard
      // write that starts after the request returns.
      copy: (secret) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": reveal(secret).then((value) => new Blob([value], { type: "text/plain" })),
          }),
        ]),
      reset: () => post(routes.reset, state),
      codes: async () =>
        version >= 3
          ? post(version === 4 ? VAULT_V4_ROUTES.codes : VAULT_V3_ROUTES.codes, decodeHostVaultCodes)
          : { codes: [] },
      ...(importable ? { importCsv } : {}),
    },
    (read) =>
      onHostEvent((event) => {
        if (event.type === "vault-changed") read();
      }),
  );
}

/** A card with no `fillSites` keeps them all; the key stays out of the body, as JSON has no undefined. */
function cardBody({ fillSites, ...card }: Extract<VaultSaveInput, { kind: "card" }>) {
  return fillSites === undefined ? card : { ...card, fillSites };
}

/** A login with no `twoStepKey` keeps its saved key; the key stays out of the body, as for `fillSites`. */
function loginBody({ twoStepKey, ...login }: Extract<VaultSaveInput, { kind: "login" }>) {
  return twoStepKey === undefined ? login : { ...login, twoStepKey };
}

/** An item with no `agents` keeps its saved agents; the key stays out of the body, as for `fillSites`. */
function saveBody(input: VaultSaveInput) {
  const { agents, ...body } =
    input.kind === "card" ? cardBody(input) : input.kind === "login" ? loginBody(input) : { ...input };
  return agents === undefined ? body : { ...body, agents };
}
