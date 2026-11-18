// The password managers of this computer and of a joined server (`password-managers-v1`): list,
// connect, cancel a sign-in, and disconnect. An access key or an extra password goes from the
// renderer to main or to the host once; no answer carries it.

import {
  decodeHostPasswordManagerList,
  decodeHostPasswordManagerStatus,
  isPasswordManagerId,
  type PasswordManagerConnectInput,
  type PasswordManagerConnectMethod,
  type PasswordManagerId,
} from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  PASSWORD_MANAGERS_CAPABILITY,
  PASSWORD_MANAGERS_KEY_LIMIT,
  PASSWORD_MANAGERS_PASSWORD_LIMIT,
  PASSWORD_MANAGERS_ROUTES,
} from "@openbot/contracts/team-protocol/password-managers-v1";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import type { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { PasswordManagersService } from "../password-managers/password-managers-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";
import { isObject, requireString } from "./validation";

export interface PasswordManagersIpcDependencies {
  passwordManagers: Pick<PasswordManagersService, "list" | "connect" | "cancel" | "disconnect" | "signInPage">;
  remoteServers: {
    supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
    request<T>(
      serverId: string,
      path: string,
      decoder: ResponseDecoder<T>,
      init?: RemoteRequestInit,
    ): Effect.Effect<T, RemoteWorkflowError>;
  };
  /** Opens a sign-in page in this computer's browser. */
  openExternal: (url: string) => Promise<void>;
}

function decodeManager(value: unknown): PasswordManagerId {
  if (!isPasswordManagerId(value)) throw new Error("Invalid password manager.");
  return value;
}

function decodeMethod(value: unknown): PasswordManagerConnectMethod {
  if (!isObject(value)) throw new Error("Invalid password manager connect method.");
  if (value.kind === "browser") return { kind: "browser" };
  if (value.kind === "key") {
    const key = requireString(value.key, "key", PASSWORD_MANAGERS_KEY_LIMIT);
    registerSecretValue(key);
    return { kind: "key", key };
  }
  if (value.kind === "extra-password") {
    const password = requireString(value.password, "password", PASSWORD_MANAGERS_PASSWORD_LIMIT);
    registerSecretValue(password, { allowShort: true });
    return { kind: "extra-password", password };
  }
  throw new Error("Invalid password manager connect method.");
}

function decodeConnectInput(value: unknown): PasswordManagerConnectInput {
  if (!isObject(value)) throw new Error("Invalid password manager connect input.");
  return { manager: decodeManager(value.manager), method: decodeMethod(value.method) };
}

/**
 * The renderer names a manager only, never a URL: main opens the sign-in page that the driver or the
 * host reports, and only an `https:` page on one of the driver's sign-in hosts.
 */
export function passwordManagersIpcHandlers({
  passwordManagers,
  remoteServers,
  openExternal,
}: PasswordManagersIpcDependencies): Pick<IpcGroupHandlers, "passwordManagers"> {
  function post<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    body: PasswordManagerConnectInput | { manager: PasswordManagerId } | null = null,
  ): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PASSWORD_MANAGERS_CAPABILITY))
      throw new Error(sourceText("error.team.connectorsUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: body ?? {} }));
  }
  async function open(page: string | null): Promise<void> {
    if (!page) throw new Error(sourceText("error.connector.passwordManagerNoSignIn"));
    await openExternal(page);
  }
  const openLocal = (manager: PasswordManagerId) => open(passwordManagers.signInPage(manager));

  return {
    passwordManagers: {
      list: handler(() => passwordManagers.list()),
      connect: payloadHandler(decodeConnectInput, (input) => runCauseEffect(passwordManagers.connect(input))),
      cancel: payloadHandler(decodeManager, (manager) => runCauseEffect(passwordManagers.cancel(manager))),
      disconnect: payloadHandler(decodeManager, (manager) => runCauseEffect(passwordManagers.disconnect(manager))),
      openSignIn: payloadHandler(decodeManager, openLocal),
      hostList: scopedQueryHandler({
        local: () => passwordManagers.list(),
        remote: (serverId) => post(serverId, PASSWORD_MANAGERS_ROUTES.list, decodeHostPasswordManagerList),
      }),
      hostConnect: scopedHandler(decodeConnectInput, {
        local: (input) => runCauseEffect(passwordManagers.connect(input)),
        remote: (input, serverId) =>
          post(serverId, PASSWORD_MANAGERS_ROUTES.connect, decodeHostPasswordManagerStatus, input),
      }),
      hostCancel: scopedHandler(decodeManager, {
        local: (manager) => runCauseEffect(passwordManagers.cancel(manager)),
        remote: (manager, serverId) =>
          post(serverId, PASSWORD_MANAGERS_ROUTES.cancel, decodeHostPasswordManagerStatus, { manager }),
      }),
      hostDisconnect: scopedHandler(decodeManager, {
        local: (manager) => runCauseEffect(passwordManagers.disconnect(manager)),
        remote: (manager, serverId) =>
          post(serverId, PASSWORD_MANAGERS_ROUTES.disconnect, decodeHostPasswordManagerStatus, { manager }),
      }),
      // The host names the page; this computer opens it only on the sign-in hosts of its own driver.
      hostOpenSignIn: scopedHandler(decodeManager, {
        local: openLocal,
        remote: async (manager, serverId) => {
          const managers = await post(serverId, PASSWORD_MANAGERS_ROUTES.list, decodeHostPasswordManagerList);
          const status = managers.find((entry) => entry.manager === manager);
          await open(status ? passwordManagers.signInPage(manager, status) : null);
        },
      }),
    },
  };
}
