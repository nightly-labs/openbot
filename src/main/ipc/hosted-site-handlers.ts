// Publishing a local directory to a hosted site.

import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { HostedSiteDesktopService } from "../hosted-site-service";
import { parseDeleteHostedSite, parsePublishHostedSite, parseReplaceHostedSite } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface HostedSiteIpcDependencies {
  hostedSites: HostedSiteDesktopService;
  getMainWindow: () => BrowserWindow | null;
}

export function hostedSiteIpcHandlers({
  hostedSites,
  getMainWindow,
}: HostedSiteIpcDependencies): Pick<IpcGroupHandlers, "hostedSites"> {
  return {
    hostedSites: {
      list: handler(() => hostedSites.list()),
      chooseDirectory: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: "Choose a static site directory",
          properties: ["openDirectory"],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }),
      publish: payloadHandler(parsePublishHostedSite, (site) => hostedSites.publish(site)),
      replace: payloadHandler(parseReplaceHostedSite, (site) => hostedSites.replace(site)),
      delete: payloadHandler(parseDeleteHostedSite, (siteId) => hostedSites.delete(siteId)),
    },
  };
}
