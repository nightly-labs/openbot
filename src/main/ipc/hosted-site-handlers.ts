import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// Publishing a local directory to a hosted site, and the sites of one server.
//
// Publishing is local: agents publish from the computer that runs them. The list and the delete are
// server-scoped. A joined server answers through `hosted-sites-v1`: every member can list, and the host
// answers a delete only for an owner or admin.

import { parseHostedSiteList } from "@openbot/contracts/hosted-sites";
import type { HostedSiteList } from "@openbot/contracts/ipc";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { HOSTED_SITES_CAPABILITY, HOSTED_SITES_ROUTES } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { HostedSiteDesktopService } from "../hosted-site-service";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseDeleteHostedSite, parsePublishHostedSite, parseReplaceHostedSite } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

// The hosted-sites-v1 codec has already checked that the body is an empty record.
const acceptEmpty = (): undefined => undefined;

function decodeRemoteSiteList(value: unknown): HostedSiteList {
  const list = parseHostedSiteList(value);
  if (!list) throw new Error("The host returned an invalid site list.");
  return list;
}

interface HostedSiteRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export interface HostedSiteIpcDependencies {
  hostedSites: HostedSiteDesktopService;
  remoteServers: HostedSiteRemoteServers;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function hostedSiteIpcHandlers({
  hostedSites,
  remoteServers,
  getMainWindow,
  translate,
}: HostedSiteIpcDependencies): Pick<IpcGroupHandlers, "hostedSites"> {
  /** A host that predates the capability answers 404, so the reason is stated before the request. */
  function requireRemoteSupport(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, HOSTED_SITES_CAPABILITY))
      throw new Error(sourceText("error.team.hostedSitesUnsupported"));
  }

  return {
    hostedSites: {
      list: scopedQueryHandler({
        local: () => Effect.runPromise(hostedSites.list().pipe(Effect.mapError((error) => error.cause))),
        remote: (serverId) => {
          requireRemoteSupport(serverId);
          return Effect.runPromise(
            remoteServers
              .request(serverId, HOSTED_SITES_ROUTES.list, decodeRemoteSiteList, {
                method: "POST",
                body: {},
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
      chooseDirectory: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseSiteDirectory"),
          properties: ["openDirectory"],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }),
      publish: payloadHandler(parsePublishHostedSite, (site) =>
        Effect.runPromise(hostedSites.publish(site).pipe(Effect.mapError((error) => error.cause))),
      ),
      replace: payloadHandler(parseReplaceHostedSite, (site) =>
        Effect.runPromise(hostedSites.replace(site).pipe(Effect.mapError((error) => error.cause))),
      ),
      delete: scopedHandler(parseDeleteHostedSite, {
        local: ({ siteId }) =>
          Effect.runPromise(hostedSites.delete(siteId).pipe(Effect.mapError((error) => error.cause))),
        remote: ({ siteId }, serverId) => {
          requireRemoteSupport(serverId);
          return Effect.runPromise(
            remoteServers
              .request(serverId, HOSTED_SITES_ROUTES.remove, acceptEmpty, {
                method: "POST",
                body: { siteId },
              })
              .pipe(Effect.mapError((error: RemoteWorkflowError) => error.cause)),
          );
        },
      }),
    },
  };
}
