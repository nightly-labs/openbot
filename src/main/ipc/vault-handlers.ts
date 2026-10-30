// The Vault of this computer, for Server settings of the local server. Main opens the CSV file dialog
// and writes the clipboard, so a copied secret does not pass through the renderer. The `host*`
// endpoints do the same for one server: a joined server answers through `vault-v2`, or through
// `vault-v1` without API keys when it is older.

import { readFile, stat } from "node:fs/promises";
import {
  decodeHostVaultSecret,
  decodeHostVaultState,
  type VaultSaveInput,
  type VaultSecretRequest,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { VAULT_CAPABILITY, VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY, VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { type BrowserWindow, clipboard, dialog, type OpenDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { decodeVaultSaveInput, decodeVaultSecretRequest } from "../vault-inputs";
import { VAULT_CSV_LIMIT, type VaultService } from "../vault-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { stringPayload } from "./validation";

export interface VaultIpcDependencies {
  vault: VaultService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
}

export function vaultIpcHandlers({
  vault,
  getMainWindow,
  translate,
  remoteServers,
}: VaultIpcDependencies): Pick<IpcGroupHandlers, "vault"> {
  function post<T>(
    serverId: string,
    route: keyof typeof VAULT_ROUTES,
    decode: ResponseDecoder<T>,
    body: VaultSaveInput | VaultSecretRequest | { id: string } | Record<string, never> = {},
  ): Promise<T> {
    const routes = remoteServers.supportsCapability(serverId, VAULT_V2_CAPABILITY)
      ? VAULT_V2_ROUTES
      : remoteServers.supportsCapability(serverId, VAULT_CAPABILITY)
        ? VAULT_ROUTES
        : null;
    if (!routes) throw new Error(sourceText("error.team.vaultUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, routes[route], decode, { method: "POST", body }));
  }
  // A secret from a joined server is redacted from logs here as well, as on its host. The security
  // code is not: a three-digit pattern would remove numbers from every log line.
  const remoteReveal = async (request: VaultSecretRequest, serverId: string): Promise<string> => {
    const secret = await post(serverId, "reveal", decodeHostVaultSecret, request);
    if (request.field !== "securityCode")
      registerSecretValue(secret, { allowShort: request.field === "password" || request.field === "key" });
    return secret;
  };

  const chooseCsv = async (): Promise<string | null> => {
    const mainWindow = getMainWindow();
    const options: OpenDialogOptions = {
      title: translate("dialog.chooseVaultCsv"),
      properties: ["openFile"],
      filters: [{ name: translate("dialog.filter.csv"), extensions: ["csv"] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };

  return {
    vault: {
      list: handler(() => vault.state()),
      save: payloadHandler(decodeVaultSaveInput, (input) => runCauseEffect(vault.save(input))),
      delete: payloadHandler(stringPayload("id", 64), (id) => runCauseEffect(vault.delete(id))),
      reveal: payloadHandler(decodeVaultSecretRequest, (request) => vault.reveal(request)),
      copy: payloadHandler(decodeVaultSecretRequest, (request) => {
        clipboard.writeText(vault.reveal(request));
      }),
      importCsv: handler(async () => {
        const path = await chooseCsv();
        if (!path) return null;
        const info = await stat(path);
        if (!info.isFile()) throw new Error(sourceText("error.vault.csvInvalid"));
        if (info.size > VAULT_CSV_LIMIT) throw new Error(sourceText("error.vault.csvTooLarge"));
        return runCauseEffect(vault.importCsv(await readFile(path, "utf8")));
      }),
      reset: handler(() => runCauseEffect(vault.reset())),
      hostList: scopedQueryHandler({
        local: () => vault.state(),
        remote: (serverId) => post(serverId, "list", decodeHostVaultState),
      }),
      hostSave: scopedHandler(decodeVaultSaveInput, {
        local: (input) => runCauseEffect(vault.save(input)),
        remote: (input, serverId) => {
          // A new password, card number or API key crosses this computer too, so it is redacted here as well.
          if (input.kind === "login" && input.password !== null)
            registerSecretValue(input.password, { allowShort: true });
          if (input.kind === "card" && input.number !== null) registerSecretValue(input.number);
          if (input.kind === "apiKey" && input.key !== null) registerSecretValue(input.key, { allowShort: true });
          return post(serverId, "save", decodeHostVaultState, input);
        },
      }),
      hostDelete: scopedHandler(stringPayload("id", 64), {
        local: (id) => runCauseEffect(vault.delete(id)),
        remote: (id, serverId) => post(serverId, "delete", decodeHostVaultState, { id }),
      }),
      hostReveal: scopedHandler(decodeVaultSecretRequest, {
        local: (request) => vault.reveal(request),
        remote: remoteReveal,
      }),
      hostCopy: scopedHandler(decodeVaultSecretRequest, {
        local: (request) => {
          clipboard.writeText(vault.reveal(request));
        },
        remote: async (request, serverId) => {
          clipboard.writeText(await remoteReveal(request, serverId));
        },
      }),
      hostReset: scopedQueryHandler({
        local: () => runCauseEffect(vault.reset()),
        remote: (serverId) => post(serverId, "reset", decodeHostVaultState),
      }),
    },
  };
}
