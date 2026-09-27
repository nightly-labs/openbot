import { createSimpleContext } from "../../simple-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "./custom-providers-context";
import { providerDetectionPort } from "./custom-providers-port";
import { createProviderDetectionStore } from "./stores/provider-detection-store";

/**
 * What this computer found, beside the endpoints and agents it can save. Mounted inside both of
 * their contexts and above `ServerScopeBoundary`: the scan is of this computer, so a server switch
 * keeps it. Nothing scans at mount; onboarding and the AI providers tab start a scan when shown.
 */
const ProviderDetection = createSimpleContext({
  name: "Provider detection",
  init: () =>
    createProviderDetectionStore({
      api: () => providerDetectionPort().providerDetection,
      endpoints: useCustomProviders(),
      agents: useCustomAgents(),
    }),
});

export const ProviderDetectionProvider = ProviderDetection.provider;
export const useProviderDetection = ProviderDetection.use;
