import {
  type BrowserFormRequest,
  LOCAL_SERVER_ID,
  parseBrowserFormRequest,
  parseBrowserFormSubmission,
} from "@openbot/contracts/ipc";
import type { AgentService } from "../../backend/agent-service";
import type { BrowserHost } from "../../backend/browser-host";
import type { RemoteServerManager } from "../remote-server-manager";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

interface BrowserFormIpcDependencies {
  browser: Pick<BrowserHost, "readTakeoverForm" | "submitTakeoverForm">;
  service: Pick<AgentService, "assertBrowserTakeover" | "respondToBrowserTakeover">;
  remoteServers: Pick<RemoteServerManager, "activeServerId">;
}

/** Local user input has no Team API route and never becomes an agent tool argument. */
export function browserFormIpcHandlers({
  browser,
  service,
  remoteServers,
}: BrowserFormIpcDependencies): Pick<IpcGroupHandlers["browser"], "readTakeoverForm" | "submitTakeoverForm"> {
  const assertTakeover = (input: BrowserFormRequest) => {
    if (remoteServers.activeServerId !== LOCAL_SERVER_ID) throw new Error("Browser forms require a local workspace.");
    service.assertBrowserTakeover(input);
  };
  return {
    readTakeoverForm: payloadHandler(parseBrowserFormRequest, (input) => {
      assertTakeover(input);
      return browser.readTakeoverForm(input.tabId, () => assertTakeover(input));
    }),
    submitTakeoverForm: payloadHandler(parseBrowserFormSubmission, async (input) => {
      assertTakeover(input);
      const result = await browser.submitTakeoverForm(input, () => assertTakeover(input));
      assertTakeover(input);
      if (result.status === "complete")
        await service.respondToBrowserTakeover({ requestId: input.requestId, decision: "complete" });
      return result;
    }),
  };
}
