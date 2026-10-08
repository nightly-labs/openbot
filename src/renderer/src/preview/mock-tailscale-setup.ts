import type { HostAdminDesktopApi, TailscaleSetupStatus } from "@openbot/contracts/ipc";
import { clone } from "./mock-support";

type MockTailscaleSetupApi = Pick<
  HostAdminDesktopApi,
  "getTailscaleSetup" | "setTailscaleDirect" | "startTailscaleSignIn"
>;

/**
 * The owner's Tailscale setup of a joined server. The preview host starts with Tailscale installed but
 * signed out; a sign-in connects it to the owner's tailnet with HTTPS certificates on.
 */
export function createMockTailscaleSetup(): MockTailscaleSetupApi {
  let status: TailscaleSetupStatus = {
    client: { state: "connected", tailnet: "story-tailnet.ts.net", deviceName: "Studio Mac" },
    host: {
      state: "signed-out",
      tailnet: null,
      deviceName: null,
      dnsName: null,
      httpsCertificates: false,
      enabled: false,
      url: null,
      issue: null,
      issueDetail: null,
      loginUrl: null,
      environment: "linux",
      wslNetworking: null,
      setupCommand: true,
      signInIssue: null,
    },
    network: null,
  };
  return {
    getTailscaleSetup: async () => clone(status),
    startTailscaleSignIn: async () => {
      status = {
        ...status,
        host: {
          ...status.host,
          state: "connected",
          tailnet: "story-tailnet.ts.net",
          deviceName: "home-server",
          dnsName: "home-server.story-tailnet.ts.net",
          httpsCertificates: true,
        },
        network: "same",
      };
      return clone(status);
    },
    setTailscaleDirect: async (enabled) => {
      status = {
        ...status,
        host: { ...status.host, enabled, url: enabled ? "https://home-server.story-tailnet.ts.net" : null },
      };
      return clone(status);
    },
  };
}
