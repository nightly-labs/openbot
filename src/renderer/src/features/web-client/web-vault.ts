import { decodeHostVaultSecret, decodeHostVaultState, type VaultSaveInput } from "@openbot/contracts/ipc";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { remoteVaultCalls, type VaultCalls } from "../vault/vault-port";
import type { WebWorkspace } from "./web-client-context";

/**
 * The Vault of the connected host (`vault-v2`, or `vault-v1` without API keys), for its owner or
 * admin. The browser has no main process, so a copy shows the secret to this page and puts it on the
 * clipboard here. There is no CSV import: the file is on this computer, not on the host.
 */
export function webVaultCalls(
  request: () => TeamApiRequest,
  onHostEvent: WebWorkspace["onHostEvent"],
  v2: boolean,
): VaultCalls {
  const routes = v2 ? VAULT_V2_ROUTES : VAULT_ROUTES;
  const post = <T>(path: string, decode: (value: unknown) => T, body: Parameters<TeamApiRequest>[3] = {}) =>
    request()("POST", path, decode, body);
  const reveal: VaultCalls["reveal"] = (secret) => post(routes.reveal, decodeHostVaultSecret, { ...secret });
  return remoteVaultCalls(
    {
      list: () => post(routes.list, decodeHostVaultState),
      save: (input) => post(routes.save, decodeHostVaultState, input.kind === "card" ? cardBody(input) : { ...input }),
      remove: (id) => post(routes.delete, decodeHostVaultState, { id }),
      reveal,
      // The write starts in the click, with the value still on its way: Safari refuses a clipboard
      // write that starts after the request returns.
      copy: (secret) =>
        navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": reveal(secret).then((value) => new Blob([value], { type: "text/plain" })),
          }),
        ]),
      reset: () => post(routes.reset, decodeHostVaultState),
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
