// headless-host-adapter: the minimal HostService surface that ServerMode requires
// (Pick<HostService, "getStatus" | "configure" | "start" | "updateIdentity" |
// "getMobileConnectHost" | "refreshRegistration">) until the real HostService wiring
// lands. Status answers are honest: the host is not serving until that happens.

import type { HostStatus } from "@openbot/contracts/ipc-team-host";

export class HeadlessHostAdapter {
  #name: string | null = null;

  getStatus(): HostStatus {
    return {
      phase: "signed_out" as const,
      configured: false,
      enabledOnLaunch: false,
      serverId: null,
      serverName: this.#name,
      apiUrl: null,
      logoUrl: null,
      appearance: null,
      apiOnline: false,
      remoteDesktopReady: false,
      remoteDesktopScreenRecordingDenied: false,
      remoteDesktopUnattended: false,
      remoteDesktopActiveSessions: 0,
      remoteDesktopMaxSessions: 0,
      message: "headless host: agent service not wired yet",
    };
  }

  async configure(input: { name: string }): Promise<void> {
    this.#name = input.name;
  }

  async start(): Promise<void> {
    // TODO: real HostService owns this; the team API stays down until then.
  }

  async updateIdentity(): Promise<void> {}

  async getMobileConnectHost(): Promise<null> {
    return null;
  }

  async refreshRegistration(): Promise<void> {}
}
