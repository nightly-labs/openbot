import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { createSimpleContext } from "../../simple-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "./custom-providers-context";
import { desktopProviderDetectionCalls } from "./custom-providers-port";
import { createProviderDetectionStore } from "./stores/provider-detection-store";

const ProviderDetection = createSimpleContext({
  name: "Provider detection",
  init: () =>
    createProviderDetectionStore({
      api: () => desktopProviderDetectionCalls(LOCAL_SERVER_ID),
      endpoints: useCustomProviders(),
      agents: useCustomAgents(),
    }),
});

export const ProviderDetectionProvider = ProviderDetection.provider;
export const useProviderDetection = ProviderDetection.use;
